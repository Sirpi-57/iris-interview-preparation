# -*- coding: utf-8 -*-
import os
import tempfile
import json
import re
import time
import threading
import uuid
import base64
from io import BytesIO
from datetime import datetime, timedelta
from PyPDF2 import PdfReader
from flask import Flask, request, jsonify # Removed send_file as we're not sending local files anymore
from flask_cors import CORS
import requests
from werkzeug.utils import secure_filename
import shutil
from dotenv import load_dotenv
import anthropic
import traceback

# --- Add Firebase Imports ---
import firebase_admin
from firebase_admin import credentials, firestore, storage # storage client initialized but not used yet
# --- End Firebase Imports ---

# Load environment variables (keep this)
load_dotenv()

# --- API Keys & Constants ---
# Make sure these are set in Render Environment Variables
CLAUDE_API_KEY = os.environ.get("CLAUDE_API_KEY")
CLAUDE_MODEL = "claude-3-5-sonnet-20240620"
CLAUDE_HAIKU_MODEL = "claude-3-haiku-20240307"
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = "gemini-1.5-flash-latest"
GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/"
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions"
MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY") # Added based on original code
MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions" # Added based on original code
AWS_DEFAULT_REGION = os.environ.get("AWS_DEFAULT_REGION")
# AWS Keys might be needed if IAM role on Render doesn't work for Polly
# AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
# AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
# --- Boto3 import moved inside generate_speech_polly to avoid import error if not used ---

PORT = int(os.environ.get('PORT', 5000)) # Use Render's PORT env var
BASE_TEMP_DIR = tempfile.mkdtemp(prefix="iris_temp_") # For initial local save before Storage upload
# --- End Constants ---

# --- Firebase Admin SDK Initialization ---
db = None
bucket = None
try:
    service_account_json_str = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON')
    if service_account_json_str:
        service_account_info = json.loads(service_account_json_str)
        cred = credentials.Certificate(service_account_info)
        project_id = service_account_info.get('project_id')
        if not project_id:
             raise ValueError("Project ID not found in Firebase credentials.")

        firebase_admin.initialize_app(cred, {
            'storageBucket': f"{project_id}.appspot.com"
        })
        print("Firebase Admin SDK initialized successfully.")
        db = firestore.client()
        print("Firestore client initialized.")
        bucket = storage.bucket()
        print("Storage client initialized.")
    else:
        print("CRITICAL ERROR: FIREBASE_SERVICE_ACCOUNT_JSON environment variable not set.")
except json.JSONDecodeError as e:
    print(f"CRITICAL ERROR: Failed to parse Firebase credentials from JSON string: {e}")
except ValueError as e:
     print(f"CRITICAL ERROR: Invalid Firebase credentials or missing project_id: {e}")
except Exception as e:
    print(f"CRITICAL ERROR: Unexpected error initializing Firebase Admin SDK: {e}")
    traceback.print_exc()
# --- End Firebase Initialization ---

# --- Flask App Setup ---
app = Flask(__name__)
# Update allowed_origin for deployed frontend later, use "*" for initial testing if needed, but be specific for production
allowed_origin = "*" # Use Render URL or custom domain later: os.environ.get("FRONTEND_URL", "*")
CORS(app, origins=[allowed_origin], supports_credentials=True)
# --- End Flask App Setup ---


# === Firestore Helper Functions ===

def get_session_data(session_id):
    """Retrieves session data from Firestore."""
    if not db: return None
    try:
        doc_ref = db.collection('sessions').document(session_id)
        doc = doc_ref.get()
        if doc.exists:
            return doc.to_dict()
        else:
            return None
    except Exception as e:
        print(f"Error getting session {session_id} from Firestore: {e}")
        return None

def update_session_data(session_id, updates):
    """Updates specific fields for a session document in Firestore."""
    if not db:
        print(f"ERROR: Firestore not initialized. Cannot update session {session_id}")
        return False
    try:
        session_ref = db.collection('sessions').document(session_id)
        updates['last_updated'] = firestore.SERVER_TIMESTAMP
        session_ref.update(updates)
        return True
    except Exception as e:
        print(f"ERROR: Failed to update Firestore session {session_id}: {e}")
        return False

def get_interview_data(interview_id):
    """Retrieves interview data from Firestore."""
    if not db: return None
    try:
        doc_ref = db.collection('interviews').document(interview_id)
        doc = doc_ref.get()
        if doc.exists:
            return doc.to_dict()
        else:
            return None
    except Exception as e:
        print(f"Error getting interview {interview_id} from Firestore: {e}")
        return None

def update_interview_data(interview_id, updates):
    """Updates specific fields for an interview document in Firestore."""
    if not db:
        print(f"ERROR: Firestore not initialized. Cannot update interview {interview_id}")
        return False
    try:
        interview_ref = db.collection('interviews').document(interview_id)
        updates['last_updated'] = firestore.SERVER_TIMESTAMP
        interview_ref.update(updates)
        return True
    except Exception as e:
        print(f"ERROR: Failed to update Firestore interview {interview_id}: {e}")
        return False

def add_conversation_message(interview_id, role, content):
    """Adds a message to the conversation array in Firestore using ArrayUnion."""
    if not db: return False
    try:
        interview_ref = db.collection('interviews').document(interview_id)
        message = {'role': role, 'content': content, 'timestamp': firestore.SERVER_TIMESTAMP}
        interview_ref.update({
            'conversation': firestore.ArrayUnion([message]),
            'last_updated': firestore.SERVER_TIMESTAMP
        })
        return True
    except Exception as e:
        print(f"ERROR: Failed to add message to interview {interview_id}: {e}")
        return False

# === Existing Helper Functions (Keep implementations as they were) ===

def extract_text_from_pdf(file_path):
    print(f"Extracting text from: {file_path}")
    try:
        reader = PdfReader(file_path)
        text = "".join([page.extract_text() + "\n" for page in reader.pages if page.extract_text()])
        print(f"Extracted {len(text)} characters.")
        if not text.strip():
             print(f"Warning: No text extracted from {os.path.basename(file_path)}")
        return text.strip()
    except Exception as e:
        print(f"Error extracting text from PDF {os.path.basename(file_path)}: {e}")
        traceback.print_exc()
        raise # Re-raise to be caught by background task handler

def call_claude_api(messages, system_prompt, model=CLAUDE_MODEL, temperature=0.7, max_tokens=4096):
    if not CLAUDE_API_KEY: raise ValueError("Claude API Key is not configured.")
    user_assistant_messages = [msg for msg in messages if msg.get("role") != "system"]
    if not user_assistant_messages:
        user_assistant_messages = [{"role": "user", "content": "<BEGIN>"}] # Placeholder if needed

    print(f"--- Calling Claude ({model}) ---")
    payload = {
        "model": model, "max_tokens": max_tokens, "messages": user_assistant_messages,
        "system": system_prompt, "temperature": temperature
    }
    headers = {
        "Content-Type": "application/json", "anthropic-version": "2023-06-01",
        "x-api-key": CLAUDE_API_KEY
    }
    try:
        response = requests.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload, timeout=90) # Increased timeout
        print(f"Claude API response status: {response.status_code}")
        response.raise_for_status()
        response_data = response.json()
        content_blocks = response_data.get("content", [])
        if not content_blocks: raise Exception(f"Claude API response missing 'content'. Data: {response_data}")
        claude_response_text = "".join([block.get("text", "") for block in content_blocks if block.get("type") == "text"])
        if not claude_response_text: raise Exception(f"Claude API response content block has no text. Blocks: {content_blocks}")
        return claude_response_text
    except requests.exceptions.RequestException as e:
        error_msg = f"Claude API request error ({model}): {e}"
        if hasattr(e, 'response') and e.response is not None: error_msg += f" | Status: {e.response.status_code}, Body: {e.response.text[:500]}"
        print(error_msg)
        raise Exception(error_msg) from e
    except Exception as e:
        error_msg = f"Claude API error ({model}): {e}"
        print(error_msg)
        raise Exception(error_msg) from e


def get_gemini_url(model_name):
    if not GEMINI_API_KEY: raise ValueError("Gemini API Key not configured.")
    return f"{GEMINI_API_URL_BASE}{model_name}:generateContent?key={GEMINI_API_KEY}"

def call_gemini_api(prompt, model=GEMINI_MODEL, temperature=0.4, response_mime_type=None):
    if not GEMINI_API_KEY: raise ValueError("Gemini API Key is not configured.")
    generation_config = {"temperature": temperature}
    if response_mime_type: generation_config["response_mime_type"] = response_mime_type
    payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": generation_config}
    try:
        gemini_url = get_gemini_url(model)
        response = requests.post(gemini_url, headers={"Content-Type": "application/json"}, json=payload, timeout=90) # Increased timeout
        response.raise_for_status()
        data = response.json()
        candidates = data.get("candidates")
        content = candidates[0].get("content") if candidates else None
        parts = content.get("parts") if content else None
        if not parts: raise Exception("Gemini API response missing required structure ('candidates'/'content'/'parts').")
        return parts[0].get("text")
    except requests.exceptions.RequestException as e:
        print(f"Gemini API request error: {e}")
        raise Exception(f"Gemini API request failed: {e}") from e
    except Exception as e:
        print(f"Gemini API Error: {e}")
        raise

def generate_speech_polly(text, voice_id="Kajal", region_name=None):
    """Generates speech using AWS Polly."""
    import boto3 # Import here to avoid global dependency if not used/configured
    from botocore.exceptions import BotoCoreError, ClientError
    try:
        effective_region = region_name if region_name else AWS_DEFAULT_REGION
        if not effective_region:
            raise ValueError("AWS Region not configured via argument or AWS_DEFAULT_REGION env var.")

        # Boto3 will automatically look for credentials (env vars, shared file, IAM role)
        polly_client = boto3.client('polly', region_name=effective_region)
        print(f"Attempting AWS Polly TTS with voice: {voice_id} in region: {polly_client.meta.region_name}")

        response = polly_client.synthesize_speech(
            Text=text, OutputFormat='mp3', VoiceId=voice_id,
            Engine='neural', LanguageCode='en-IN'
        )
        if "AudioStream" in response:
            audio_data = response['AudioStream'].read()
            print(f"AWS Polly TTS successful, generated {len(audio_data)} bytes.")
            return audio_data
        else:
            raise Exception("Polly response missing audio stream")
    except (BotoCoreError, ClientError) as e:
        print(f"AWS Polly API error: {e}")
        traceback.print_exc()
        raise Exception(f"AWS Polly API error: {e}") from e
    except Exception as e:
        print(f"Unexpected error during Polly TTS generation: {e}")
        traceback.print_exc()
        raise # Re-raise other exceptions

def generate_speech(text):
    """Generates speech from text, trying Polly then falling back to OpenAI."""
    # --- Attempt 1: AWS Polly (Kajal) ---
    if AWS_DEFAULT_REGION: # Only attempt if region is set
        try:
            print("Attempting AWS Polly TTS...")
            return generate_speech_polly(text, voice_id="Kajal", region_name=AWS_DEFAULT_REGION)
        except Exception as polly_e:
            print(f"AWS Polly TTS failed, falling back to OpenAI TTS. Error: {polly_e}")
    else:
        print("AWS_DEFAULT_REGION not set, skipping Polly TTS.")

    # --- Attempt 2: OpenAI TTS (Fallback) ---
    if not OPENAI_API_KEY: raise ValueError("Neither AWS Polly nor OpenAI TTS is configured/working.")
    print("Using fallback OpenAI TTS with 'nova' voice.")
    payload = {"model": "tts-1", "voice": "nova", "input": text, "response_format": "mp3"}
    try:
        response = requests.post(
            OPENAI_TTS_URL,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
            json=payload, timeout=30
        )
        response.raise_for_status()
        print(f"OpenAI TTS fallback successful, generated {len(response.content)} bytes.")
        return response.content
    except requests.exceptions.RequestException as e:
        error_body = e.response.text[:500] if hasattr(e, 'response') and e.response else "No response body"
        print(f"OpenAI TTS API request error (fallback): {e}. Body: {error_body}")
        raise Exception(f"OpenAI TTS fallback failed: {e}") from e
    except Exception as e:
        print(f"Unexpected OpenAI TTS API error (fallback): {e}")
        raise Exception(f"Unexpected OpenAI TTS fallback error: {e}") from e

def transcribe_audio(audio_file_bytes, filename='audio.webm'):
    """Transcribes audio using OpenAI Whisper."""
    if not OPENAI_API_KEY: raise ValueError("OpenAI API Key not configured.")
    try:
        files = {"file": (filename, audio_file_bytes)}
        data = {"model": "whisper-1"}
        response = requests.post(
            OPENAI_STT_URL, headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            files=files, data=data, timeout=60
        )
        response.raise_for_status()
        data = response.json()
        return data.get("text", "")
    except requests.exceptions.RequestException as e:
        print(f"OpenAI STT API request error: {e}")
        raise Exception(f"OpenAI STT API request failed: {e}") from e
    except Exception as e:
        print(f"OpenAI STT API error: {e}")
        raise Exception(f"OpenAI STT API error: {e}") from e


def parse_resume_with_claude(resume_text):
    """Parses resume text using the Claude API."""
    if not CLAUDE_API_KEY: raise ValueError("Claude API Key not configured.")
    system_prompt = f"""
You are an expert resume parser. Analyze this resume text:
--- START ---
{resume_text[:30000]}
--- END ---
Extract the following information and return it as a valid JSON object only (no explanations):
{{
"name": "...", "email": "...", "phoneNumber": "...", "location": "...",
"yearsOfExperience": "...", "technicalSkills": [...], "companiesWorkedAt": [...],
"projects": [...], "education": [...], "languages": [...], "frameworks": [...],
"certifications": [...], "otherRelevantInfo": "...", "currentPosition": "..."
}}
If a field is not found, use null, "", or []. Ensure name, email, phoneNumber are present if found.
"""
    messages = [{"role": "user", "content": "Parse this resume."}]
    try:
        response_content = call_claude_api(
            messages=messages, system_prompt=system_prompt,
            model=CLAUDE_HAIKU_MODEL, temperature=0.2
        )
        # Extract JSON part carefully
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1
        if json_start >= 0 and json_end > json_start:
            json_text = response_content[json_start:json_end]
            parsed_json = json.loads(json_text)
        else: # Fallback if no {} found, maybe Claude returned pure JSON?
             try:
                 parsed_json = json.loads(response_content)
             except json.JSONDecodeError:
                 raise ValueError(f"Could not find or parse JSON in Claude resume parsing response: {response_content[:500]}")
        # Defaulting key fields
        parsed_json.setdefault("name", None)
        parsed_json.setdefault("email", None)
        # ... add other setdefaults if needed ...
        print("Resume parsed successfully by Claude.")
        return parsed_json
    except json.JSONDecodeError as e:
        print(f"Claude resume parsing JSON error: {e}. Response: {response_content[:500]}")
        raise Exception("Claude API returned invalid JSON during resume parsing.") from e
    except Exception as e:
        print(f"Claude resume parsing error: {e}")
        raise

def match_resume_jd_with_gemini(resume_data, job_description):
    """Matches resume (JSON) with job description using Gemini."""
    print("--- Matching Resume/JD with Gemini (Requesting 5-8 Improvements) ---")
    if not GEMINI_API_KEY: raise ValueError("Gemini API Key is not configured.")
    resume_data_str = json.dumps(resume_data, indent=2) if isinstance(resume_data, dict) else str(resume_data)
    prompt = f"""
Act as an expert AI career advisor. Compare the candidate's resume data against the provided job description.
Job Description:
--- START JD ---
{job_description[:10000]}
--- END JD ---
Candidate Resume Data (JSON):
--- START JSON ---
{resume_data_str[:10000]}
--- END JSON ---
Perform a comprehensive analysis and return ONLY a single valid JSON object with these exact fields:
- "matchScore": integer 0-100
- "matchAnalysis": string (2-3 paragraphs explanation)
- "keyStrengths": array of objects [{{"strength": "...", "relevance": "..."}}]
- "skillGaps": array of objects [{{"missingSkill": "...", "importance": "high/medium/low", "suggestion": "..."}}]
- "jobRequirements": object {{"jobTitle": "...", "requiredSkills": [...], "experienceLevel": "...", "educationNeeded": "..."}}
- "resumeImprovements": array of 5-8 objects [{{"section": "...", "issue": "...", "recommendation": "...", "example": "..."}}]
Ensure valid JSON structure with NO extra text before or after.
"""
    try:
        result_text = call_gemini_api(prompt=prompt, model=GEMINI_MODEL, temperature=0.2, response_mime_type="application/json")
        # Clean potential markdown backticks
        if result_text.strip().startswith("```json"): result_text = result_text.strip()[7:]
        if result_text.strip().endswith("```"): result_text = result_text.strip()[:-3]
        match_result_obj = json.loads(result_text.strip(), strict=False)
        # Basic Validation (Example - expand as needed)
        match_result_obj.setdefault("matchScore", 0)
        match_result_obj.setdefault("matchAnalysis", "[Analysis not provided]")
        match_result_obj.setdefault("keyStrengths", [])
        match_result_obj.setdefault("skillGaps", [])
        match_result_obj.setdefault("jobRequirements", {})
        match_result_obj.setdefault("resumeImprovements", [])
        print(f"Gemini analysis complete. Match Score: {match_result_obj.get('matchScore')}")
        return match_result_obj
    except json.JSONDecodeError as e:
        print(f"Gemini analysis JSON decoding error: {e}. Response text (partial): {result_text[:1000]}")
        return {"error": "Invalid JSON from Gemini analysis", "matchScore": 0, "matchAnalysis": f"[Error: {e}]", "keyStrengths": [], "skillGaps": [], "jobRequirements": {}, "resumeImprovements": []}
    except Exception as e:
        print(f"Gemini analysis error: {e}")
        traceback.print_exc()
        return {"error": str(e), "matchScore": 0, "matchAnalysis": f"[Error: {e}]", "keyStrengths": [], "skillGaps": [], "jobRequirements": {}, "resumeImprovements": []}


def generate_interview_prep_plan(resume_match_data):
    """Generates a personalized interview prep plan using Claude (no timeline)."""
    print("--- Generating Prep Plan (No Timeline) ---")
    if not CLAUDE_API_KEY: raise ValueError("Claude API Key not configured.")
    # Extract context safely
    match_score = resume_match_data.get("matchScore", 0)
    match_analysis = resume_match_data.get("matchAnalysis", "")
    skill_gaps = resume_match_data.get("skillGaps", [])
    job_requirements = resume_match_data.get("jobRequirements", {})
    parsed_resume = resume_match_data.get("parsedResume", {}) # Assumes parsedResume is added to match_results
    try:
        gaps_str = json.dumps(skill_gaps, indent=2)
        requirements_str = json.dumps(job_requirements, indent=2)
        resume_summary_str = json.dumps({k: parsed_resume.get(k) for k in ['name', 'currentPosition', 'yearsOfExperience', 'technicalSkills']}, indent=2)
    except Exception as json_err:
        print(f"Warning: Could not serialize data for prep plan prompt - {json_err}")
        gaps_str, requirements_str, resume_summary_str = str(skill_gaps), str(job_requirements), str(parsed_resume)

    system_prompt = f"""
You are an expert interview coach creating a prep plan based on analysis.
Candidate Summary: {resume_summary_str}
Job Requirements: {requirements_str}
Identified Skill Gaps: {gaps_str}
Analysis Summary: Match Score: {match_score}/100. {match_analysis}

Create a plan as a JSON object ONLY with these sections (no timeline):
1. "focusAreas": [4-6 specific technical/non-technical topics]
2. "likelyQuestions": [15-20 objects [{{"category": "...", "question": "...", "guidance": "SPECIFIC, tailored advice (1-2 sentences)"}}]]
3. "conceptsToStudy": [Detailed technical concepts/tools based on JD and gaps]
4. "gapStrategies": [For EACH gap: [{{"gap": "...", "strategy": "Concrete advice to address gap in interview", "focus_during_prep": "What to study beforehand"}}]]

Your response MUST be only the valid JSON object. **DO NOT INCLUDE a 'preparationTimeline' section.**
"""
    messages = [{"role": "user", "content": "Generate the detailed interview preparation plan (excluding timeline)."}]
    response_content = ""
    try:
        response_content = call_claude_api(
            messages=messages, system_prompt=system_prompt, model=CLAUDE_MODEL,
            max_tokens=4096, temperature=0.5
        )
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1
        if json_start >= 0 and json_end > json_start:
            json_text = response_content[json_start:json_end].strip()
            prep_plan = json.loads(json_text, strict=False)
            # Basic validation
            prep_plan.setdefault("focusAreas", [])
            prep_plan.setdefault("likelyQuestions", [])
            prep_plan.setdefault("conceptsToStudy", [])
            prep_plan.setdefault("gapStrategies", [])
            if "preparationTimeline" in prep_plan: del prep_plan["preparationTimeline"]
            print("Prep plan (no timeline) generated successfully.")
            return prep_plan
        else:
            raise ValueError(f"Valid JSON object not found in prep plan response: {response_content[:1000]}")
    except json.JSONDecodeError as e:
        print(f"Prep plan JSON decoding error: {e}. Response text: {json_text[:1000]}")
        raise Exception("Claude API returned invalid JSON for prep plan.") from e
    except Exception as e:
        print(f"Error generating interview prep plan (no timeline): {e}")
        traceback.print_exc()
        raise Exception(f"Failed to generate prep plan: {str(e)}") from e

def generate_dynamic_timeline_with_gemini(session_data, days):
    """Generates a dynamic, day-by-day interview prep timeline using Gemini."""
    print(f"--- Generating Dynamic Timeline with Gemini ({days} days) ---")
    if not GEMINI_API_KEY: raise ValueError("Gemini API Key is not configured.")
    if not session_data: raise ValueError("Session data is required to generate timeline.")
    prep_plan = session_data.get('results', {}).get('prep_plan', {})
    match_results = session_data.get('results', {}).get('match_results', {})
    parsed_resume = session_data.get('results', {}).get('parsed_resume', {})
    focus_areas = prep_plan.get('focusAreas', [])
    concepts_to_study = prep_plan.get('conceptsToStudy', [])
    skill_gaps = match_results.get('skillGaps', [])
    job_title = match_results.get('jobRequirements', {}).get('jobTitle', 'the position')
    candidate_name = parsed_resume.get('name', 'Candidate')
    try:
        focus_areas_str = "- " + "\n- ".join(focus_areas) if focus_areas else "N/A"
        if isinstance(concepts_to_study, dict): concepts_str = json.dumps(concepts_to_study, indent=2)
        elif isinstance(concepts_to_study, list): concepts_str = "- " + "\n- ".join(concepts_to_study) if concepts_to_study else "N/A"
        else: concepts_str = str(concepts_to_study)
        gaps_str = json.dumps(skill_gaps, indent=2) if skill_gaps else "None identified."
    except Exception as json_err:
        print(f"Warning: Could not serialize context for timeline prompt - {json_err}")
        focus_areas_str, concepts_str, gaps_str = str(focus_areas), str(concepts_to_study), str(skill_gaps)

    prompt = f"""
Act as an expert interview coach. Create a detailed, day-by-day preparation timeline for {candidate_name} interviewing for a {job_title} position in {days} days.
Context:
* Duration: {days} days
* Key Focus Areas: {focus_areas_str[:1000]}
* Concepts to Study: {concepts_str[:2000]}
* Gaps to Address: {gaps_str[:1000]}

Instructions:
1. Create plan for {days} days + "Interview Day".
2. For each day (1 to {days}): Define `focus` (string), `schedule` (array of objects [{{"time_slot": "Optional time", "task": "Specific task..."}}]), `notes` (string). Tasks should cover concepts, question practice (STAR method), gap strategies, company research. Distribute focus areas/concepts.
3. For "Interview Day": Focus on relaxation, quick review, setup check.
4. Optionally, estimate `estimated_total_hours` (integer).
5. Output ONLY a valid JSON object: {{"timeline": [{{"day": 1/.. /"Interview Day", "focus": "...", "schedule": [...], "notes": "..."}}], "estimated_total_hours": <int, optional>}}
Strictly follow JSON format. No extra text or markdown.
"""
    try:
        result_text = call_gemini_api(prompt=prompt, model=GEMINI_MODEL, temperature=0.5, response_mime_type="application/json")
        if result_text.strip().startswith("```json"): result_text = result_text.strip()[7:]
        if result_text.strip().endswith("```"): result_text = result_text.strip()[:-3]
        timeline_data = json.loads(result_text.strip(), strict=False)
        if "timeline" not in timeline_data or not isinstance(timeline_data.get("timeline"), list):
             print("Warning: 'timeline' key missing or not a list in Gemini response.")
             timeline_data = {"timeline": [], "error": "Generated timeline structure was invalid."}
        else:
            print(f"Dynamic timeline generated successfully ({len(timeline_data['timeline'])} entries).")
        return timeline_data
    except json.JSONDecodeError as e:
        print(f"Gemini timeline JSON decoding error: {e}. Response text (partial): {result_text[:1000]}")
        return {"timeline": [], "error": f"Failed to parse timeline JSON: {e}"}
    except Exception as e:
        print(f"Error generating dynamic timeline with Gemini: {e}")
        traceback.print_exc()
        return {"timeline": [], "error": f"Failed to generate timeline: {str(e)}"}

def create_mock_interviewer_prompt(resume_data, job_data, interview_type="general"):
    """Creates the system prompt for the AI interviewer."""
    job_title = job_data.get("jobRequirements", {}).get("jobTitle", "the position")
    required_skills = job_data.get("jobRequirements", {}).get("requiredSkills", [])
    experience_level = job_data.get("jobRequirements", {}).get("experienceLevel", "")
    candidate_name = resume_data.get("name", "the candidate")
    current_position = resume_data.get("currentPosition", "their background")
    years_experience = resume_data.get("yearsOfExperience", "")
    skills = resume_data.get("technicalSkills", [])
    skills_str = ", ".join(required_skills) if required_skills else "as specified"
    candidate_skills_str = ", ".join(skills) if skills else "listed skills"
    experience_str = f" with {years_experience} of experience" if years_experience else ""

    system_prompt = f"""
You are an AI Interviewer conducting a structured mock interview. You are interviewing {candidate_name} ({current_position}{experience_str}) for a {job_title} role requiring {experience_level} experience and skills in {skills_str}. Candidate mentioned skills: {candidate_skills_str}. The interview type is '{interview_type}'.

**Persona:** Professional, engaging, PATIENT (wait for responses, don't interrupt), adaptive (ask relevant follow-ups), objective, concise.

**Mandatory Structure:** Follow these stages, adapting questions based on the '{interview_type}' focus:
1.  **Intro & Rapport (1-2 Qs):** Greet, state purpose ({job_title} mock), ask "Tell me about yourself" or similar.
2.  **Experience/Foundation:** If technical/general, ask about general experience/core skills. If behavioral, ask about past roles/teams.
3.  **Technical Deep Dive (Focus for 'technical'/'general'):** Ask specific technical questions on {skills_str}, increasing complexity. Present scenarios. Validate resume skills ({candidate_skills_str}). Ask for logic/approach for coding Qs (no live coding). Minimize/skip if purely 'behavioral'.
4.  **Project Discussion (All types):** Ask about 1-2 significant projects: contributions, challenges, tech, outcomes. Relate to {job_title}.
5.  **Behavioral/Situational (Focus for 'behavioral', include in 'general'):** Use STAR prompts ("Tell me about a time..."). Assess teamwork, problem-solving, pressure handling relevant to {job_title}/{experience_level}. Include standards like strengths/weaknesses (with examples), career goals.
6.  **Candidate Questions & Logistics (Brief):** Ask if candidate has Qs (give generic answers about mock process). Maybe one simple logistical Q if relevant (no salary).
7.  **Closing (Final Response):** Signal end. Thank candidate. Brief, neutral closing ("Thank you for sharing..."). State that a detailed analysis report will be available after. End professionally ("That concludes our mock interview...").

**Constraints:** Adhere to flow. BE PATIENT. Be concise. Ask questions, don't answer. Stay in character. No detailed feedback during the interview.
"""
    return system_prompt

def analyze_interview_performance(interview_transcript, job_requirements, resume_data):
    """Analyzes the interview transcript using Claude."""
    print("--- Starting Interview Analysis (Stricter Prompt Version) ---")
    response_content = ""
    json_text_raw = ""
    try:
        job_req_str = json.dumps(job_requirements, indent=2)
        resume_str = json.dumps(resume_data, indent=2)
        transcript_length = len(interview_transcript)
        system_prompt = f"""
You are an expert interview coach providing DETAILED and HONEST analysis of a mock interview transcript based PRIMARILY on the interaction recorded.
Job Requirements: {job_req_str[:2000]}
Candidate Resume (Context ONLY): {resume_str[:5000]}
Interview Transcript (Length: {transcript_length} chars):
--- BEGIN TRANSCRIPT ---
{interview_transcript[:20000]}
--- END TRANSCRIPT ---

**VERY IMPORTANT SCORING:** Base scores (`technicalAssessment`, `communicationAssessment`, `behavioralAssessment`) PRIMARILY on transcript evidence. Do NOT give high scores just based on the resume if the transcript lacks proof. If transcript interaction is minimal, scores MUST be low (0-30 range). State limitations in `overallAssessment` if transcript is short.

Create analysis as a JSON object ONLY with this exact structure (no extra text):
{{
"overallScore": <int 0-100, reflects transcript performance>,
"overallAssessment": "<string assessment, 2-3 paragraphs, *mention transcript limitations if any*>",
"technicalAssessment": {{"score": <int 0-100, *transcript evidence*>, "strengths": ["<string demonstrated *in transcript*>"], "weaknesses": ["<string demonstrated *in transcript*>"], "feedback": "<string feedback on technical aspects *shown in transcript*>"}},
"communicationAssessment": {{"score": <int 0-100, *transcript evidence*>, "strengths": ["<string demonstrated *in transcript*, e.g., clarity>"], "weaknesses": ["<string demonstrated *in transcript*, e.g., vagueness>"], "feedback": "<string feedback on communication *shown in transcript*>"}},
"behavioralAssessment": {{"score": <int 0-100, *transcript evidence*>, "strengths": ["<string demonstrated *in transcript*, e.g., STAR>"], "weaknesses": ["<string demonstrated *in transcript*, e.g., generic>"], "feedback": "<string feedback on behavioral aspects *shown in transcript*>"}},
"specificFeedback": [ // Focus on actual question/answer pairs from transcript
  {{"question": "<interviewer question *from transcript*>", "response": "<candidate response summary *from transcript*>", "assessment": "<feedback on *this* response>", "improvement": "<suggestion for *this* response>"}}
],
"keyImprovementAreas": [ // Derived from weaknesses observed *in transcript*
  {{"area": "<e.g., 'STAR Method Usage'>", "recommendation": "<detailed recommendation>", "practiceExercise": "<specific exercise>"}}
]
}}
"""
        messages = [{"role": "user", "content": "Analyze my interview performance based *primarily* on the provided transcript interaction."}]
        response_content = call_claude_api(
            messages=messages, system_prompt=system_prompt, model=CLAUDE_MODEL,
            max_tokens=4096, temperature=0.4
        )
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1
        if json_start != -1 and json_end != -1 and json_end > json_start:
            json_text_raw = response_content[json_start:json_end].strip()
            analysis = json.loads(json_text_raw, strict=False)
            print("Interview analysis generated successfully.")
            # Basic validation can be added here if needed
            analysis.setdefault("overallScore", 0)
            analysis.setdefault("overallAssessment", "[Analysis Error]")
            analysis.setdefault("technicalAssessment", {"score": 0, "strengths": [], "weaknesses": [], "feedback": ""})
            analysis.setdefault("communicationAssessment", {"score": 0, "strengths": [], "weaknesses": [], "feedback": ""})
            analysis.setdefault("behavioralAssessment", {"score": 0, "strengths": [], "weaknesses": [], "feedback": ""})
            analysis.setdefault("specificFeedback", [])
            analysis.setdefault("keyImprovementAreas", [])
            return analysis
        else:
            raise ValueError(f"Valid JSON object not found in analysis response: {response_content[:1000]}")
    except json.JSONDecodeError as e:
        error_pos = getattr(e, 'pos', '?')
        error_msg = getattr(e, 'msg', 'Unknown JSON error')
        print(f"*** JSON Decode Error during analysis: {error_msg} at position {error_pos}")
        log_text = json_text_raw if json_text_raw else response_content
        print(f"--- Raw Text Failed Parsing (partial) ---\n{log_text[:2000]}\n------------------------------------")
        raise Exception("Failed to parse valid interview analysis JSON.") from e
    except Exception as e:
        print(f"Error during interview analysis generation: {e}")
        traceback.print_exc()
        raise Exception(f"An unexpected error occurred during analysis: {str(e)}") from e

def generate_suggested_answers(transcript, resume_data, job_data):
    """Generates suggested answers for interviewer questions found in the transcript."""
    print("--- Generating Suggested Answers ---")
    if not CLAUDE_API_KEY: raise ValueError("Claude API Key not configured.")
    resume_str = json.dumps(resume_data, indent=2)
    job_req_str = json.dumps(job_data.get("jobRequirements", {}), indent=2)
    skill_gaps_str = json.dumps(job_data.get("skillGaps", []), indent=2)
    system_prompt = f"""
You are an expert interview coach reviewing a mock interview transcript. Provide strong alternative answers the candidate could have given, tailored to their profile.
Candidate Profile: {resume_str[:5000]}
Job Requirements: {job_req_str}
Identified Skill Gaps: {skill_gaps_str}
Interview Transcript:
--- BEGIN TRANSCRIPT ---
{transcript[:20000]}
--- END TRANSCRIPT ---

Instructions:
1. Identify ONLY the questions asked by the 'Interviewer'.
2. For each distinct Interviewer question:
   a. Generate 1-2 distinct, strong example answers *this candidate* could give based on their resume/job reqs.
   b. If addressing a skill gap, frame it positively.
   c. For each answer, provide a brief (1-sentence) 'rationale' (why it's good - e.g., "Uses STAR method," "Highlights relevant skill X," "Quantifies achievement").
3. Format output as a single, valid JSON object ONLY (no extra text):
{{
"suggestedAnswers": [
  {{
    "question": "<Exact Interviewer question>",
    "suggestions": [ {{"answer": "<Example Answer 1>", "rationale": "<Rationale 1>"}}, {{"answer": "<Example Answer 2>", "rationale": "<Rationale 2>"}} ]
  }}
  // ... repeat for each Interviewer question
]
}}
"""
    messages = [{"role": "user", "content": "Analyze the transcript and provide suggested answers for the interviewer questions."}]
    response_content = ""
    try:
        response_content = call_claude_api(
            messages=messages, system_prompt=system_prompt, model=CLAUDE_MODEL,
            max_tokens=4096, temperature=0.6
        )
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1
        if json_start != -1 and json_end != -1 and json_end > json_start:
            json_text_raw = response_content[json_start:json_end].strip()
            suggested_data = json.loads(json_text_raw, strict=False)
            if "suggestedAnswers" not in suggested_data or not isinstance(suggested_data["suggestedAnswers"], list):
                 print("Warning: 'suggestedAnswers' key missing or invalid in Claude response.")
                 suggested_data = {"suggestedAnswers": []}
            print("Suggested answers generated successfully.")
            return suggested_data
        else:
            raise ValueError("Valid JSON object not found for suggested answers.")
    except json.JSONDecodeError as e:
         print(f"*** JSON Decode Error for suggested answers: {e}")
         print(f"--- Raw Text Failed Parsing ---\n{json_text_raw[:2000]}\n---")
         raise Exception("Failed to parse suggested answers JSON.") from e
    except Exception as e:
        print(f"Error generating suggested answers: {e}")
        # print(f"Full Claude response content on error:\n{response_content}") # Uncomment for deep debug
        raise Exception(f"Failed to generate suggestions: {str(e)}") from e


def rewrite_resume_section(resume_data, job_description, section_to_improve):
    """Rewrites a specific section of the resume to better match the job description."""
    if not CLAUDE_API_KEY: raise ValueError("Claude API Key not configured.")
    resume_str = json.dumps(resume_data, indent=2)
    system_prompt = f"""
You are an expert resume writer improving the "{section_to_improve}" section of a resume for a specific job.
Resume Data: {resume_str[:10000]}
Job Description: {job_description[:10000]}
Section to Improve: {section_to_improve}

Rewrite the {section_to_improve} section to be aligned with job requirements, use action verbs, quantify achievements, and be ATS-friendly.
Format response as a JSON object ONLY:
{{
"original": "[current content]",
"improved": "[your rewritten content]",
"explanations": [ {{"change": "[specific change]", "rationale": "[why it improves]"}} ]
}}
No additional explanation.
"""
    messages = [{"role": "user", "content": f"Please rewrite the {section_to_improve} section."}]
    response_content = ""
    try:
        response_content = call_claude_api(messages=messages, system_prompt=system_prompt, model=CLAUDE_MODEL)
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1
        if json_start >= 0 and json_end > json_start:
            json_text = response_content[json_start:json_end]
            rewrite_result = json.loads(json_text)
        else: # Fallback
             rewrite_result = json.loads(response_content)
        print(f"Resume section '{section_to_improve}' rewritten successfully.")
        return rewrite_result
    except json.JSONDecodeError as e:
        print(f"Rewrite JSON decoding error: {e}. Response: {response_content[:500]}")
        raise Exception("Failed to generate valid resume rewrite JSON.") from e
    except Exception as e:
        print(f"Error rewriting resume section: {e}")
        raise

def get_duration(start_time_str, end_time_str):
    """Calculate duration between two ISO format datetime strings."""
    if not start_time_str or not end_time_str: return "N/A"
    try:
        start_time = datetime.fromisoformat(start_time_str)
        end_time = datetime.fromisoformat(end_time_str)
        duration_seconds = (end_time - start_time).total_seconds()
        minutes = int(duration_seconds // 60)
        seconds = int(duration_seconds % 60)
        return f"{minutes}m {seconds}s"
    except Exception: return "N/A"


# === Flask Routes ===

@app.route('/test', methods=['GET'])
def test_route():
    """Simple health check endpoint."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db_status = "OK" if db else "Unavailable"
    bucket_status = "OK" if bucket else "Unavailable"
    config_status = {
        "firebase_admin_sdk": "OK" if firebase_admin._DEFAULT_APP_NAME in firebase_admin._apps else "Not Initialized",
        "firestore_client": db_status,
        "storage_client": bucket_status,
        "claude_ok": bool(CLAUDE_API_KEY),
        "gemini_ok": bool(GEMINI_API_KEY),
        "openai_ok": bool(OPENAI_API_KEY),
        "mistral_ok": bool(MISTRAL_API_KEY),
        "aws_region_ok": bool(AWS_DEFAULT_REGION)
    }
    return jsonify({
        'status': 'ok',
        'message': f'IRIS backend server running at {now}',
        'config_status': config_status
    })

@app.route('/analyze-resume', methods=['POST'])
def analyze_resume():
    """Analyzes resume against JD, stores session in Firestore."""
    session_id = None
    temp_session_dir = None # Keep track of directory to delete
    try:
        start_time = time.time()
        if 'resumeFile' not in request.files: return jsonify({'error': 'No resume file'}), 400
        resume_file = request.files['resumeFile']
        job_description = request.form.get('jobDescription')
        if not job_description: return jsonify({'error': 'Job description required'}), 400
        if not resume_file or not resume_file.filename: return jsonify({'error': 'Invalid resume file'}), 400
        if not (resume_file.content_type == 'application/pdf' or resume_file.filename.lower().endswith('.pdf')):
             return jsonify({'error': 'Only PDF resumes supported'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503

        session_id = str(uuid.uuid4())
        print(f"[{session_id}] Received /analyze-resume request.")

        # --- Temporary File Handling ---
        temp_session_dir = os.path.join(BASE_TEMP_DIR, session_id)
        os.makedirs(temp_session_dir, exist_ok=True)
        resume_filename = secure_filename(resume_file.filename)
        temp_resume_path = os.path.join(temp_session_dir, resume_filename)
        resume_file.save(temp_resume_path)
        print(f"[{session_id}] Resume temporarily saved to: {temp_resume_path}")
        # --- End Temp File Handling ---

        # Initialize session doc immediately
        session_ref = db.collection('sessions').document(session_id)
        initial_session_data = {
            'status': 'processing', 'progress': 5,
            'resume_filename_temp': resume_filename, 'job_description': job_description,
            'start_time': datetime.now().isoformat(), 'results': {}, 'errors': [],
            'last_updated': firestore.SERVER_TIMESTAMP
        }
        session_ref.set(initial_session_data)
        print(f"[{session_id}] Initial session created in Firestore.")

        # Define background task
        def process_resume_background(current_session_id, resume_path_to_process, jd):
            session_status = 'failed' # Assume failure unless explicitly completed
            error_list = []
            try:
                print(f"[{current_session_id}] Background task started.")
                update_session_data(current_session_id, {'progress': 10, 'status_detail': 'Extracting text'})
                resume_text = extract_text_from_pdf(resume_path_to_process)
                if not resume_text: raise ValueError("Failed to extract text from PDF.")

                update_session_data(current_session_id, {'progress': 30, 'status_detail': 'Parsing resume'})
                parsed_resume = parse_resume_with_claude(resume_text)
                if not parsed_resume or not parsed_resume.get("name"): raise ValueError("Failed to parse resume.")
                # Save intermediate result
                update_session_data(current_session_id, {'parsed_resume_data': parsed_resume})

                update_session_data(current_session_id, {'progress': 50, 'status_detail': 'Matching resume/JD'})
                match_results = match_resume_jd_with_gemini(parsed_resume, jd)
                if match_results.get("error"): raise ValueError(f"JD matching failed: {match_results['error']}")
                match_results['parsedResume'] = parsed_resume # Add for context
                update_session_data(current_session_id, {'match_results_data': match_results})

                update_session_data(current_session_id, {'progress': 80, 'status_detail': 'Generating prep plan'})
                prep_plan = generate_interview_prep_plan(match_results)
                if not prep_plan: raise ValueError("Failed to generate prep plan.")
                update_session_data(current_session_id, {'prep_plan_data': prep_plan})

                final_results = {
                    'parsed_resume': parsed_resume, 'match_results': match_results, 'prep_plan': prep_plan
                }
                update_session_data(current_session_id, {
                    'results': final_results, 'status': 'completed', 'progress': 100,
                    'status_detail': 'Analysis complete', 'end_time': datetime.now().isoformat()
                })
                session_status = 'completed'
            except Exception as e:
                error_msg = f"Error in background task for {current_session_id}: {e}"
                print(error_msg)
                traceback.print_exc()
                error_list.append(str(e))
                update_session_data(current_session_id, {
                    'status': 'failed', 'errors': firestore.ArrayUnion([str(e)]),
                    'status_detail': f'Error: {str(e)[:100]}...', 'end_time': datetime.now().isoformat()
                })
            finally:
                # --- Clean up temporary local directory ---
                dir_to_remove = os.path.dirname(resume_path_to_process)
                try:
                    if os.path.exists(dir_to_remove):
                         print(f"[{current_session_id}] Cleaning up temporary directory: {dir_to_remove}")
                         shutil.rmtree(dir_to_remove)
                except Exception as cleanup_error:
                     print(f"[{current_session_id}] WARNING: Failed to cleanup temp dir {dir_to_remove}: {cleanup_error}")
                print(f"[{current_session_id}] Background processing finished with status: {session_status}")

        # Start background thread
        processing_thread = threading.Thread(target=process_resume_background, args=(session_id, temp_resume_path, job_description))
        processing_thread.daemon = True
        processing_thread.start()

        print(f"[{session_id}] /analyze-resume request completed in {time.time() - start_time:.2f}s (background running).")
        return jsonify({'sessionId': session_id, 'status': 'processing', 'message': 'Resume analysis started'}), 202
    except Exception as e:
        print(f"Error in /analyze-resume route: {e}")
        traceback.print_exc()
        # If session_id was created, try to mark as failed in Firestore
        if session_id and db: update_session_data(session_id, {'status': 'failed', 'errors': firestore.ArrayUnion([f'Route level error: {str(e)}'])})
        # Clean up temp dir if created before error
        if temp_session_dir and os.path.exists(temp_session_dir): shutil.rmtree(temp_session_dir)
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/get-analysis-status/<session_id>', methods=['GET'])
def get_analysis_status(session_id):
    """Returns the current status of the resume analysis from Firestore."""
    session_data = get_session_data(session_id)
    if session_data is None: return jsonify({'error': 'Session not found or expired'}), 404
    try:
        start_time = session_data.get('start_time')
        end_time = session_data.get('end_time')
        last_updated = session_data.get('last_updated')
        response = {
            'sessionId': session_id,
            'status': session_data.get('status', 'unknown'),
            'progress': session_data.get('progress', 0),
            'statusDetail': session_data.get('status_detail', ''), # Add detailed status message
            'startTime': start_time,
            'endTime': end_time,
            'lastUpdated': last_updated.isoformat() if hasattr(last_updated, 'isoformat') else str(last_updated)
        }
        if session_data.get('status') == 'completed':
            results = session_data.get('results', {})
            parsed = results.get('parsed_resume', {})
            matched = results.get('match_results', {})
            response['summary'] = {
                'name': parsed.get('name'),
                'matchScore': matched.get('matchScore'),
                'analysisComplete': True,
                'prepPlanComplete': 'prep_plan' in results
            }
        if session_data.get('status') == 'failed':
            response['errors'] = session_data.get('errors', ['Unknown error occurred'])
        return jsonify(response)
    except Exception as e:
        print(f"Error processing status for {session_id}: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error processing status: {str(e)}'}), 500


@app.route('/get-full-analysis/<session_id>', methods=['GET'])
def get_full_analysis(session_id):
    """Returns the complete analysis results from Firestore."""
    session_data = get_session_data(session_id)
    if session_data is None: return jsonify({'error': 'Session not found or expired'}), 404
    try:
        status = session_data.get('status')
        if status != 'completed':
            return jsonify({
                 'status': status or 'unknown',
                 'progress': session_data.get('progress', 0),
                 'message': 'Analysis not yet completed'
            }), 400 # Bad Request or 202 Accepted might be better if still processing

        results = session_data.get('results', {})
        # Return only the core results needed by the frontend for display
        return jsonify({
             'sessionId': session_id,
             'parsedResume': results.get('parsed_resume'), # Keep for context/potential use
             'matchResults': results.get('match_results'),
             'prepPlan': results.get('prep_plan')
        })
    except Exception as e:
        print(f"Error retrieving full analysis for {session_id}: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error retrieving analysis: {str(e)}'}), 500


@app.route('/generate-dynamic-timeline', methods=['POST'])
def generate_dynamic_timeline_route():
    """Generates a dynamic interview preparation timeline."""
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON payload'}), 400
        session_id = data.get('sessionId')
        days_str = data.get('days')
        if not session_id: return jsonify({'error': 'Session ID required'}), 400
        if not days_str: return jsonify({'error': 'Number of days required'}), 400
        try:
            days = int(days_str)
            if days <= 0 or days > 90: raise ValueError("Invalid number of days.")
        except ValueError: return jsonify({'error': 'Please enter valid days (1-90).'}), 400

        session_data = get_session_data(session_id)
        if session_data is None: return jsonify({'error': 'Session not found or expired'}), 404
        if session_data.get('status') != 'completed' or not session_data.get('results', {}).get('prep_plan'):
             return jsonify({'error': 'Completed analysis with prep plan required first'}), 400

        print(f"[{session_id}] Request received for dynamic timeline: {days} days")
        timeline_result = generate_dynamic_timeline_with_gemini(session_data, days)
        if "error" in timeline_result:
             error_msg = timeline_result.get('error', 'Timeline generation failed.')
             print(f"[{session_id}] Error generating dynamic timeline: {error_msg}")
             return jsonify({'error': error_msg}), 500
        return jsonify(timeline_result)
    except Exception as e:
        print(f"Error in /generate-dynamic-timeline route: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error generating timeline: {str(e)}'}), 500


@app.route('/rewrite-resume-section', methods=['POST'])
def rewrite_resume_section_route():
    """Rewrites a specific section of the resume."""
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON payload'}), 400
        session_id = data.get('sessionId')
        section = data.get('section')
        if not session_id or not section: return jsonify({'error': 'Session ID and section required'}), 400

        session_data = get_session_data(session_id)
        if session_data is None: return jsonify({'error': 'Session not found or expired'}), 404
        if session_data.get('status') != 'completed': return jsonify({'error': 'Analysis not completed'}), 400

        resume_data = session_data.get('results', {}).get('parsed_resume')
        job_description = session_data.get('job_description')
        if not resume_data or not job_description: return jsonify({'error': 'Required data missing from session'}), 500

        rewrite_result = rewrite_resume_section(resume_data, job_description, section)
        return jsonify(rewrite_result)
    except Exception as e:
        print(f"Error in /rewrite-resume-section: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/start-mock-interview', methods=['POST'])
def start_mock_interview():
    """Initializes a new mock interview session in Firestore."""
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON payload'}), 400
        session_id = data.get('sessionId')
        interview_type = data.get('interviewType', 'general')
        if not session_id: return jsonify({'error': 'Session ID required'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503

        session_data = get_session_data(session_id)
        if session_data is None: return jsonify({'error': 'Session not found or expired'}), 404
        if session_data.get('status') != 'completed': return jsonify({'error': 'Analysis not completed'}), 400

        resume_data = session_data.get('results', {}).get('parsed_resume')
        job_data = session_data.get('results', {}).get('match_results')
        if not resume_data or not job_data: return jsonify({'error': 'Required analysis data missing'}), 500

        interview_id = str(uuid.uuid4())
        system_prompt = create_mock_interviewer_prompt(resume_data, job_data, interview_type)

        # Initial greeting generation
        initial_prompt = f"Start the '{interview_type}' interview with {resume_data.get('name', 'the candidate')}. Give a brief professional greeting and ask your first question."
        try:
            greeting = call_claude_api(
                messages=[{"role": "user", "content": initial_prompt}],
                system_prompt=system_prompt, model=CLAUDE_MODEL
            )
        except Exception as e:
            print(f"[{session_id}] Error generating greeting for interview {interview_id}: {e}")
            greeting = f"Hello {resume_data.get('name', 'there')}. Welcome to your {interview_type} mock interview. Let's begin. Can you start by telling me a bit about yourself and your background?"

        # Create interview document in Firestore
        interview_doc_ref = db.collection('interviews').document(interview_id)
        interview_data_to_save = {
            'sessionId': session_id, # Link back to the analysis session
            # 'userId': '...', # TODO: Add user ID when auth is implemented
            'interviewType': interview_type,
            'system_prompt': system_prompt, # Store for reference, maybe? Can be large.
            'conversation': [{'role': 'assistant', 'content': greeting, 'timestamp': firestore.SERVER_TIMESTAMP}], # Start conversation
            'status': 'active',
            'start_time': datetime.now().isoformat(),
            'last_updated': firestore.SERVER_TIMESTAMP,
            'resume_data_snapshot': resume_data, # Snapshot data used for this interview
            'job_data_snapshot': job_data
        }
        interview_doc_ref.set(interview_data_to_save)
        print(f"[{session_id}] Started interview {interview_id} of type {interview_type}.")

        return jsonify({'interviewId': interview_id, 'sessionId': session_id, 'interviewType': interview_type, 'greeting': greeting})
    except Exception as e:
        print(f"Error in /start-mock-interview: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/interview-response', methods=['POST'])
def interview_response():
    """Processes user response, gets AI response, updates Firestore conversation."""
    try:
        data = request.get_json()
        interview_id = data.get('interviewId')
        user_response = data.get('userResponse')
        if not interview_id: return jsonify({'error': 'Interview ID required'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503

        interview_data = get_interview_data(interview_id)
        if interview_data is None: return jsonify({'error': 'Interview session not found'}), 404
        if interview_data.get('status') != 'active': return jsonify({'error': 'Interview is not active'}), 400

        # Add user response to conversation in Firestore
        if not add_conversation_message(interview_id, 'user', user_response):
             return jsonify({'error': 'Failed to save user response'}), 500

        # Refresh interview_data to get latest conversation for Claude context
        # Note: This reads again, potential race condition if rapid fire. Consider passing conversation directly.
        current_conversation = get_interview_data(interview_id).get('conversation', [])
        system_prompt = interview_data.get('system_prompt', '') # Fetch stored prompt

        # Generate interviewer's next response
        try:
            # Reformat conversation for Claude API if needed (role 'user'/'assistant')
            api_conversation = [{'role': msg['role'], 'content': msg['content']} for msg in current_conversation]

            interviewer_response = call_claude_api(
                messages=api_conversation, system_prompt=system_prompt, model=CLAUDE_MODEL
            )
            # Add AI response to conversation in Firestore
            if not add_conversation_message(interview_id, 'assistant', interviewer_response):
                 # Log error but maybe still return response to user?
                 print(f"[{interview_id}] Failed to save assistant response to Firestore, but proceeding.")

        except Exception as e:
            print(f"[{interview_id}] Error generating interviewer response: {e}")
            interviewer_response = "I seem to be having a technical difficulty. Could you please repeat your last point or perhaps elaborate further?"
            # Attempt to save error message as assistant response
            add_conversation_message(interview_id, 'assistant', interviewer_response)

        return jsonify({'interviewerResponse': interviewer_response})
    except Exception as e:
        print(f"Error in /interview-response route for {interview_id}: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/process-audio', methods=['POST'])
def process_audio():
    """Processes audio, transcribes it, returns transcription."""
    try:
        if 'audio' not in request.files: return jsonify({'error': 'No audio file'}), 400
        audio_file = request.files['audio']
        interview_id = request.form.get('interviewId') # Check if interview ID is needed here
        if not audio_file or not audio_file.filename: return jsonify({'error': 'Invalid audio file'}), 400
        # No check for interview_id needed if just transcribing, but good practice if context matters

        audio_bytes = audio_file.read()
        transcribed_text = transcribe_audio(audio_bytes, audio_file.filename)
        print(f"Audio transcribed (interview: {interview_id if interview_id else 'N/A'}), length: {len(transcribed_text)}")
        return jsonify({'transcription': transcribed_text})
    except Exception as e:
        print(f"Error in /process-audio: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error transcribing audio: {str(e)}'}), 500


@app.route('/generate-tts', methods=['POST'])
def generate_tts():
    """Generates speech from text."""
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON payload'}), 400
        text = data.get('text')
        if not text: return jsonify({'error': 'Text required'}), 400

        audio_content = generate_speech(text)
        audio_base64 = base64.b64encode(audio_content).decode('utf-8')
        return jsonify({'audioBase64': audio_base64})
    except Exception as e:
        print(f"Error in /generate-tts: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error generating speech: {str(e)}'}), 500


@app.route('/end-interview', methods=['POST'])
def end_interview():
    """Ends interview, triggers background analysis, updates Firestore."""
    interview_id = None
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON payload'}), 400
        interview_id = data.get('interviewId')
        if not interview_id: return jsonify({'error': 'Interview ID required'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503

        # Fetch latest interview data before updating
        interview_data = get_interview_data(interview_id)
        if interview_data is None: return jsonify({'error': 'Interview session not found'}), 404
        if interview_data.get('status') != 'active':
             # Allow ending again if already completed/failed? Or return error?
             print(f"[{interview_id}] Interview already ended (status: {interview_data.get('status')}).")
             return jsonify({'status': interview_data.get('status'), 'message': 'Interview already ended', 'analysisStatus': interview_data.get('analysis_status', 'N/A')}), 200

        print(f"[{interview_id}] Received request to end interview.")
        # Update status immediately in Firestore
        update_success = update_interview_data(interview_id, {
            'status': 'completed', # Mark as completed (before analysis)
            'end_time': datetime.now().isoformat(),
            'analysis_status': 'processing' # Indicate analysis is starting
        })
        if not update_success: return jsonify({'error': 'Failed to update interview status'}), 500

        # Get necessary data for analysis (use potentially updated data)
        updated_interview_data = get_interview_data(interview_id) # Fetch again to ensure end_time etc. is present?
        conversation = updated_interview_data.get('conversation', [])
        resume_data = updated_interview_data.get('resume_data_snapshot', {})
        job_data = updated_interview_data.get('job_data_snapshot', {}).get('jobRequirements', {}) # Pass only job reqs? Or full match results? Let's pass job_data_snapshot for now
        session_id = updated_interview_data.get('sessionId')

        # Format transcript
        transcript = "\n".join([
            f"{'Interviewer' if msg.get('role') == 'assistant' else 'Candidate'}: {msg.get('content', '')}"
            for msg in conversation
        ])

        # Define background task for analysis
        def analyze_interview_background(current_interview_id, transcript_text, job_reqs, resume_info, linked_session_id):
            analysis_result = None
            analysis_status = 'failed'
            error_msg = None
            try:
                print(f"[{current_interview_id}] Starting background analysis.")
                analysis_result = analyze_interview_performance(transcript_text, job_reqs, resume_info)
                # Store analysis in interview document
                update_interview_data(current_interview_id, {'analysis': analysis_result, 'analysis_status': 'completed'})
                analysis_status = 'completed'
                print(f"[{current_interview_id}] Analysis completed and saved.")

                # --- Track Progress ---
                if linked_session_id and analysis_result:
                    print(f"[{current_interview_id}] Attempting to track progress for session {linked_session_id}.")
                    # We'll store progress directly in the 'sessions' document for simplicity
                    session_data = get_session_data(linked_session_id)
                    if session_data:
                        past_interviews = session_data.get('progress_history', {}).get('interviews', [])
                        metrics = {
                            "date": updated_interview_data.get('end_time', datetime.now().isoformat()), # Use interview end time
                            "interviewId": current_interview_id,
                            "interviewType": updated_interview_data.get('interviewType', 'general'),
                            "overallScore": analysis_result.get("overallScore", 0),
                            "technicalScore": analysis_result.get("technicalAssessment", {}).get("score", 0),
                            "communicationScore": analysis_result.get("communicationAssessment", {}).get("score", 0),
                            "behavioralScore": analysis_result.get("behavioralAssessment", {}).get("score", 0)
                        }
                        past_interviews.append(metrics)
                        past_interviews.sort(key=lambda x: x["date"]) # Sort oldest first

                        trends = {}
                        if len(past_interviews) > 1:
                            first = past_interviews[0]
                            latest = past_interviews[-1]
                            trends = {
                                "totalInterviews": len(past_interviews),
                                "overallImprovement": latest["overallScore"] - first["overallScore"],
                                "technicalImprovement": latest["technicalScore"] - first["technicalScore"],
                                "communicationImprovement": latest["communicationScore"] - first["communicationScore"],
                                "behavioralImprovement": latest["behavioralScore"] - first["behavioralScore"],
                                "timespan": f"{(datetime.fromisoformat(latest['date']) - datetime.fromisoformat(first['date'])).days} days"
                            }

                        progress_update = {
                             'progress_history': {
                                 'interviews': past_interviews,
                                 'trends': trends
                             }
                        }
                        if update_session_data(linked_session_id, progress_update):
                            print(f"[{current_interview_id}] Progress tracked successfully for session {linked_session_id}.")
                        else:
                             print(f"[{current_interview_id}] WARNING: Failed to update progress tracking for session {linked_session_id}.")
                    else:
                         print(f"[{current_interview_id}] WARNING: Could not find session {linked_session_id} to track progress.")
                # --- End Track Progress ---

            except Exception as e:
                error_msg = f"Error analyzing interview {current_interview_id}: {e}"
                print(error_msg)
                traceback.print_exc()
                update_interview_data(current_interview_id, {'analysis_status': 'failed', 'analysis_error': str(e)})
            finally:
                 print(f"[{current_interview_id}] Background analysis finished with status: {analysis_status}")

        # Start analysis thread
        analysis_thread = threading.Thread(target=analyze_interview_background, args=(interview_id, transcript, job_data, resume_data, session_id))
        analysis_thread.daemon = True
        analysis_thread.start()

        return jsonify({'status': 'completed', 'message': 'Interview ended, analysis started', 'analysisStatus': 'processing'})
    except Exception as e:
        print(f"Error in /end-interview route for {interview_id}: {e}")
        traceback.print_exc()
        # Try to mark interview as failed if ID exists
        if interview_id and db: update_interview_data(interview_id, {'status': 'failed', 'analysis_status': 'failed', 'analysis_error': f'Route level error: {str(e)}'})
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/get-interview-analysis/<interview_id>', methods=['GET'])
def get_interview_analysis(interview_id):
    """Returns the analysis of the completed interview from Firestore."""
    try:
        if not db: return jsonify({'error': 'Database unavailable'}), 503
        interview_data = get_interview_data(interview_id)
        if interview_data is None: return jsonify({'error': 'Interview session not found'}), 404

        analysis_status = interview_data.get('analysis_status', 'not_started')

        if analysis_status == 'processing':
            return jsonify({'status': 'processing', 'message': 'Analysis is still processing'}), 202
        if analysis_status == 'failed':
            return jsonify({'status': 'failed', 'error': interview_data.get('analysis_error', 'Unknown analysis error')}), 500
        if analysis_status != 'completed' or 'analysis' not in interview_data:
            return jsonify({'status': 'not_available', 'message': 'Analysis not available or not completed'}), 400

        # Format transcript for response
        conversation = interview_data.get('conversation', [])
        formatted_transcript = [
            {'speaker': 'Interviewer' if msg.get('role') == 'assistant' else 'Candidate', 'text': msg.get('content', '')}
            for msg in conversation
        ]
        # Get progress data (might be stored separately or not exist yet)
        # For now, we assume it's fetched via /get-progress-history

        return jsonify({
            'interviewId': interview_id, # Added interview ID to response
            'analysis': interview_data['analysis'],
            'transcript': formatted_transcript,
            'interviewType': interview_data.get('interviewType'),
            'duration': get_duration(interview_data.get('start_time'), interview_data.get('end_time'))
        })
    except Exception as e:
        print(f"Error in /get-interview-analysis for {interview_id}: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error retrieving interview analysis: {str(e)}'}), 500


@app.route('/get-suggested-answers/<interview_id>', methods=['GET'])
def get_suggested_answers_route(interview_id):
    """Generates and returns suggested answers for the interview questions."""
    try:
        if not db: return jsonify({'error': 'Database unavailable'}), 503
        interview_data = get_interview_data(interview_id)
        if interview_data is None: return jsonify({'error': 'Interview session not found'}), 404
        # Require analysis to be complete? Or just need transcript? Let's require completion for now.
        # if interview_data.get('analysis_status') != 'completed':
        #     return jsonify({'error': 'Interview analysis must be completed first'}), 400

        conversation = interview_data.get('conversation', [])
        resume_data = interview_data.get('resume_data_snapshot')
        job_data = interview_data.get('job_data_snapshot') # Contains match results etc.
        if not conversation or not resume_data or not job_data:
             return jsonify({'error': 'Missing required data for generating suggestions'}), 500

        transcript_text = "\n".join([
            f"{'Interviewer' if msg.get('role') == 'assistant' else 'Candidate'}: {msg.get('content', '')}"
            for msg in conversation
        ])
        suggestions = generate_suggested_answers(transcript_text, resume_data, job_data)
        return jsonify(suggestions)
    except Exception as e:
        print(f"Error in /get-suggested-answers for {interview_id}: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error generating suggestions: {str(e)}'}), 500


@app.route('/get-progress-history/<session_id>', methods=['GET'])
def get_progress_history(session_id):
    """Returns the progress history stored within the session document."""
    try:
        if not db: return jsonify({'error': 'Database unavailable'}), 503
        session_data = get_session_data(session_id)
        if session_data is None: return jsonify({'error': 'Session not found or expired'}), 404

        progress_data = session_data.get('progress_history', {'interviews': [], 'trends': {}}) # Default if not found

        # Ensure interviews list exists
        if 'interviews' not in progress_data: progress_data['interviews'] = []
        if 'trends' not in progress_data: progress_data['trends'] = {}

        return jsonify(progress_data)
    except Exception as e:
        print(f"Error in /get-progress-history for {session_id}: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error retrieving progress: {str(e)}'}), 500


# --- Cleanup Function (Needs Review/Replacement with TTL) ---
# Commenting out for now, as direct deletion based on time is inefficient
# Consider Firestore TTL policy for automatic deletion instead.
"""
def cleanup_old_sessions():
    # ... This logic needs to be adapted for Firestore ...
    # Querying and deleting based on timestamp can be complex/costly.
    # Firestore TTL is generally preferred.
    print("Cleanup function needs reimplementation for Firestore or replacement with TTL.")
    while True:
        time.sleep(3600 * 24) # Sleep for a day
"""

# --- Main Execution ---
if __name__ == '__main__':
    print("-" * 60)
    print(f"Starting IRIS Backend Server (Firestore Integrated)...")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Flask Port: {PORT}")
    if not db:
        print("!!! WARNING: FIREBASE DB CLIENT NOT INITIALIZED !!!")
    # print(f"Base Temporary Directory: {BASE_TEMP_DIR}") # Still used temporarily
    print("-" * 60)

    # Comment out old cleanup thread start
    # cleanup_thread = threading.Thread(target=cleanup_old_sessions, daemon=True)
    # cleanup_thread.start()

    # Run Flask app using Gunicorn standard (Render's start command will use Gunicorn)
    # The following is for local testing only if needed, Render uses the Start Command.
    # Use `flask run --port=5000` or `gunicorn backend:app` locally.
    # app.run(host='0.0.0.0', port=PORT, debug=False) # debug=False for production-like Gunicorn behavior