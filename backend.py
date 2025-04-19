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
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import requests
from werkzeug.utils import secure_filename
import shutil
from dotenv import load_dotenv
import anthropic
import traceback
from flask_cors import CORS
import azure.cognitiveservices.speech as speechsdk
import boto3 
from botocore.exceptions import BotoCoreError, ClientError



load_dotenv()  # Load environment variables from .env file

app = Flask(__name__)
# Be specific about the allowed origin
allowed_origin = "https://cuddly-trout-wrqrxpw6vqwc7gq-5500.app.github.dev"
CORS(app, origins=[allowed_origin], supports_credentials=True) # Adjust origins as needed

# --- API Keys ---
MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY")
CLAUDE_API_KEY = os.environ.get("CLAUDE_API_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
# AZURE_SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY") 
# AZURE_SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION") 
AWS_DEFAULT_REGION = os.environ.get("AWS_DEFAULT_REGION")

# --- Constants ---
CLAUDE_MODEL = "claude-3-5-sonnet-20240620"  # Current model for analysis and conversations
CLAUDE_HAIKU_MODEL = "claude-3-haiku-20240307"  # Faster model for simpler tasks
GEMINI_MODEL = "gemini-1.5-flash-latest"  # For JD matching
OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions"
MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions"
GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/"
PORT = 5000
MAX_FILES = 10

# Base directory for temporary files
BASE_TEMP_DIR = tempfile.mkdtemp(prefix="interview_prep_")

# --- In-Memory Stores (Replace with DB/Redis for Production) ---
user_sessions = {}  # Stores user session data (resume, JD, analysis, plans)
interview_sessions = {}  # Stores active interview sessions (conversation, metadata, analysis)
progress_tracking = {}  # Stores user progress across multiple mock interviews

# --- Helper Functions ---

def extract_text_from_pdf(file_input):
    """Extracts text from a PDF file. Handles various input types."""
    filename = "unknown_pdf"
    try:
        if hasattr(file_input, 'read') and callable(file_input.read):
            if hasattr(file_input, 'filename'):
                filename = file_input.filename
                pdf_data = BytesIO(file_input.read())
            else:
                filename = "document.pdf"
                pdf_data = file_input
        elif isinstance(file_input, str):
            filename = os.path.basename(file_input)
            with open(file_input, 'rb') as f:
                pdf_data = BytesIO(f.read())
        else:
            raise ValueError(f"Unsupported input type: {type(file_input)}")

        reader = PdfReader(pdf_data)
        text = "".join([page.extract_text() + "\n" for page in reader.pages if page.extract_text()])
        print(f"Extracted {len(text)} characters from {filename}")
        if not text.strip():
            print(f"Warning: No text extracted from {filename}")
        return text.strip()
    except Exception as e:
        print(f"Error extracting text from PDF {filename}: {e}")
        raise


def call_claude_api(messages, system_prompt, model=CLAUDE_MODEL, temperature=0.7, max_tokens=4096):
    """Calls the Claude API with specified parameters."""
    if not CLAUDE_API_KEY:
        raise ValueError("Claude API Key is not configured.")

    user_assistant_messages = [msg for msg in messages if msg.get("role") != "system"]
    if not user_assistant_messages:
        # Use placeholder if no prior user/assistant messages exist
        user_assistant_messages = [{"role": "user", "content": "<BEGIN>"}]

    print(f"--- Calling Claude ({model}) ---")
    print(f"System prompt (first 100): {system_prompt[:100]}...")

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": user_assistant_messages,
        "system": system_prompt,
        "temperature": temperature
    }
    headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": CLAUDE_API_KEY
    }

    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers=headers,
            json=payload,
            timeout=60
        )
        print(f"Claude API response status: {response.status_code}")

        if response.status_code != 200:
            # Try to raise HTTPError, includes status code automatically
            response.raise_for_status()

        response_data = response.json()
        content_blocks = response_data.get("content", [])
        if not content_blocks:
            raise Exception(f"Claude API response missing 'content'. Data: {response_data}")

        claude_response_text = "".join([block.get("text", "") for block in content_blocks if block.get("type") == "text"])
        if not claude_response_text:
            raise Exception(f"Claude API response content block has no text. Blocks: {content_blocks}")

        return claude_response_text

    except requests.exceptions.RequestException as e:
        # Includes HTTPError raised by raise_for_status()
        error_msg = f"Claude API request error ({model}): {e}"
        if hasattr(e, 'response') and e.response is not None:
            error_msg += f" | Status: {e.response.status_code}, Body: {e.response.text[:500]}"
        print(error_msg)
        raise Exception(error_msg)  # Re-raise with more info
    except Exception as e:
        # Catch other potential errors (JSON parsing, etc.)
        error_msg = f"Claude API error ({model}): {e}"
        # 'response' might not be defined here if error happened before request
        if 'response' in locals() and response:
            error_msg += f" | Status: {response.status_code}, Body: {response.text[:500]}"
        print(error_msg)
        raise Exception(error_msg)

# ADD THIS NEW FUNCTION FOR AWS POLLY
def generate_speech_polly(text, voice_id="Kajal", region_name=None):
    """Generates speech using AWS Polly."""
    try:
        # If region is not explicitly passed, rely on AWS_DEFAULT_REGION env var or ~/.aws/config
        polly_client = boto3.client('polly', region_name=region_name if region_name else AWS_DEFAULT_REGION)
        print(f"Attempting AWS Polly TTS with voice: {voice_id} in region: {polly_client.meta.region_name}")

        response = polly_client.synthesize_speech(
            Text=text,
            OutputFormat='mp3',
            VoiceId=voice_id,
            Engine='neural', # Kajal is a Neural voice
            LanguageCode='en-IN' # Explicitly set for clarity
        )

        # Check if audio stream exists in the response
        if "AudioStream" in response:
            # Read the audio stream bytes
            audio_data = response['AudioStream'].read()
            print(f"AWS Polly TTS successful, generated {len(audio_data)} bytes.")
            return audio_data
        else:
            print("Error: AWS Polly response did not contain AudioStream.")
            raise Exception("Polly response missing audio stream")

    except (BotoCoreError, ClientError) as e:
        # Handle potential AWS errors (credentials, permissions, service issues)
        print(f"AWS Polly API error: {e}")
        traceback.print_exc()
        raise Exception(f"AWS Polly API error: {e}") from e
    except Exception as e:
        print(f"Unexpected error during Polly TTS generation: {e}")
        traceback.print_exc()
        raise # Re-raise other exceptions



def get_gemini_url(model_name):
    """Constructs the Gemini API URL."""
    if not GEMINI_API_KEY:
        raise ValueError("Gemini API Key not configured.")
    return f"{GEMINI_API_URL_BASE}{model_name}:generateContent?key={GEMINI_API_KEY}"


def call_gemini_api(prompt, model=GEMINI_MODEL, temperature=0.4, response_mime_type=None):
    """Calls the Gemini API with the given prompt."""
    if not GEMINI_API_KEY:
        raise ValueError("Gemini API Key is not configured.")

    generation_config = {"temperature": temperature}
    if response_mime_type:
        generation_config["response_mime_type"] = response_mime_type

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": generation_config
    }

    try:
        gemini_url = get_gemini_url(model)
        response = requests.post(
            gemini_url,
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=60
        )
        response.raise_for_status()

        data = response.json()
        candidates = data.get("candidates")
        content = candidates[0].get("content") if candidates else None
        parts = content.get("parts") if content else None
        if not parts:
            raise Exception("Gemini API response missing required structure ('candidates'/'content'/'parts').")

        return parts[0].get("text")

    except requests.exceptions.RequestException as e:
        print(f"Gemini API request error: {e}")
        raise Exception(f"Gemini API request failed: {e}")
    except Exception as e:
        print(f"Gemini API Error: {e}")
        raise


def generate_speech(text):
    """Generates speech from text, preferring AWS Polly Indian voice."""
    # --- Attempt 1: AWS Polly (Kajal) ---
    try:
        # Check if AWS credentials might be configured (boto3 handles actual check)
        # We need at least a region configured potentially
        aws_region = AWS_DEFAULT_REGION # Get region from env
        if not aws_region:
             print("Warning: AWS_DEFAULT_REGION not set in environment, Polly might fail if not configured otherwise.")
             # You could raise an error here or let boto3 try default config chain

        print("Attempting AWS Polly TTS...")
        # Call the new Polly function, explicitly using Kajal
        return generate_speech_polly(text, voice_id="Kajal", region_name=aws_region)

    except Exception as polly_e:
        print(f"AWS Polly TTS failed, falling back to OpenAI TTS. Error: {polly_e}")
        # Fall through to OpenAI if Polly fails


    # --- Attempt 2: OpenAI TTS (Fallback) ---
    if not OPENAI_API_KEY:
        print("Error: OpenAI API Key is also not configured. Cannot generate speech.")
        raise ValueError("Neither AWS Polly nor OpenAI TTS is configured or working.")

    print("Using fallback OpenAI TTS with 'nova' voice.")
    payload = {
        "model": "tts-1",
        "voice": "nova", # Choose a fallback voice
        "input": text,
        "response_format": "mp3"
    }
    try:
        response = requests.post(
            OPENAI_TTS_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_API_KEY}"
            },
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        print(f"OpenAI TTS fallback successful, generated {len(response.content)} bytes.")
        return response.content
    except requests.exceptions.RequestException as e:
        print(f"OpenAI TTS API request error (fallback): {e}")
        error_body = e.response.text[:500] if hasattr(e, 'response') and e.response else "No response body"
        print(f"OpenAI Response Body (partial): {error_body}")
        # Don't raise here if Polly already failed, maybe return silent audio or raise specific fallback error?
        # For now, let it raise to indicate complete failure
        raise Exception(f"OpenAI TTS fallback failed: {e}") from e
    except Exception as e:
        print(f"Unexpected OpenAI TTS API error (fallback): {e}")
        traceback.print_exc()
        raise Exception(f"Unexpected OpenAI TTS fallback error: {e}") from e


def transcribe_audio(audio_file_bytes, filename='audio.webm'):
    """Transcribes audio using OpenAI Whisper."""
    if not OPENAI_API_KEY:
        raise ValueError("OpenAI API Key not configured.")

    try:
        files = {"file": (filename, audio_file_bytes)}
        data = {"model": "whisper-1"}
        response = requests.post(
            OPENAI_STT_URL,
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            files=files,
            data=data,
            timeout=60
        )
        response.raise_for_status()
        data = response.json()
        return data.get("text", "")
    except requests.exceptions.RequestException as e:
        print(f"OpenAI STT API request error: {e}")
        raise Exception(f"OpenAI STT API request failed: {e}")
    except Exception as e:
        print(f"OpenAI STT API error: {e}")
        raise Exception(f"OpenAI STT API error: {e}")


def parse_resume_with_claude(resume_text):
    """Parses resume text using the Claude API."""
    if not CLAUDE_API_KEY:
        raise ValueError("Claude API Key not configured.")

    # --- Prompt for Claude ---
    system_prompt = f"""
You are an expert resume parser. You will receive text extracted from a resume PDF.
Your task is to organize this information into a structured format.

Analyze this resume text:
--- START ---
{resume_text[:30000]}
--- END ---

Extract the following information and return it as a valid JSON object with these exact fields:
- name: The candidate's full name
- email: The candidate's email address
- phoneNumber: The candidate's phone number (format consistently)
- location: Where the candidate is located
- yearsOfExperience: Total professional experience in years (estimate if not explicit)
- technicalSkills: Array of technical skills mentioned
- companiesWorkedAt: Array of company names where the candidate worked
- projects: Array of project names or descriptions
- education: Array of education details (degree, institution, etc.)
- languages: Array of programming languages the candidate knows
- frameworks: Array of frameworks the candidate has experience with
- certifications: Array of certifications held
- otherRelevantInfo: Any other relevant information
- currentPosition: The candidate's current or most recent position

If a field is not found, use null, "", or []. Ensure name, email, phoneNumber are present if found.
Your response must be a valid, well-formatted JSON object only - no explanations or other text.
"""

    # Define a minimal message to accompany the system prompt
    messages = [{"role": "user", "content": "Parse this resume."}]
    
    try:
        # Call the Claude API function
        response_content = call_claude_api(
            messages=messages,
            system_prompt=system_prompt,
            model=CLAUDE_HAIKU_MODEL,  # Using faster model for parsing
            temperature=0.2
        )
        
        # Extract the JSON part from the response
        # Look for the first { and last } to handle any preamble or closing text
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1
        
        if json_start >= 0 and json_end > json_start:
            json_text = response_content[json_start:json_end]
            parsed_json = json.loads(json_text)
        else:
            # If no JSON found, try to load the entire response
            parsed_json = json.loads(response_content)
        
        # Defaulting for key fields
        parsed_json.setdefault("name", None)
        parsed_json.setdefault("email", None)
        parsed_json.setdefault("phoneNumber", None)
        parsed_json.setdefault("location", "[Location not found in resume]")
        parsed_json.setdefault("technicalSkills", [])
        parsed_json.setdefault("yearsOfExperience", "N/A")
        parsed_json.setdefault("currentPosition", "N/A")
        return parsed_json

    except json.JSONDecodeError as e:
        print(f"Claude API JSON decoding error: {e}. Response: {response_content}")
        raise Exception("Claude API returned invalid JSON.")
    except Exception as e:
        print(f"Claude API error: {e}")
        raise


# --- Function to modify in backend.py ---
# Replace the existing match_resume_jd_with_gemini function

def match_resume_jd_with_gemini(resume_data, job_description):
    """
    Matches resume (JSON) with job description using Gemini.
    Provides match score, analysis, and gap identification.
    Requests 5-8 resume improvement suggestions.
    """
    print("--- Matching Resume/JD with Gemini (Requesting 5-8 Improvements) ---")
    if not GEMINI_API_KEY:
        raise ValueError("Gemini API Key is not configured.")

    # Ensure resume_data is stringified properly
    if isinstance(resume_data, dict):
        try:
            resume_data_str = json.dumps(resume_data, indent=2)
        except Exception:
            resume_data_str = str(resume_data) # Fallback
    else:
        resume_data_str = str(resume_data)

    # Limit input sizes
    jd_limit = 10000
    resume_limit = 10000

    # --- Prompt for Gemini Analysis ---
    prompt = f"""
Act as an expert AI career advisor. Perform a detailed analysis comparing the candidate's resume data against the provided job description.

Job Description:
--- START JD ---
{job_description[:jd_limit]}
--- END JD ---

Candidate Resume Data (JSON):
--- START JSON ---
{resume_data_str[:resume_limit]}
--- END JSON ---

Perform a comprehensive analysis focusing on the following:
1.  Calculate a `matchScore` (integer 0-100) indicating how well the candidate's profile matches the job requirements.
2.  Provide a detailed `matchAnalysis` (string, 2-3 paragraphs) explaining the overall match quality, addressing both fit and specific gaps.
3.  Identify specific `keyStrengths` (array of objects with "strength" and "relevance" strings) that align well with the job.
4.  Find specific `skillGaps` (array of objects with "missingSkill", "importance" ['high'/'medium'/'low'], and "suggestion" strings) that might reduce competitiveness.
5.  Extract key `jobRequirements` (object with "jobTitle", "requiredSkills" array, "experienceLevel" string, "educationNeeded" string).
6.  Provide **5 to 8 detailed `resumeImprovements`** (array of objects). For each improvement, include:
    * `"section"` (string: relevant resume section, e.g., "Experience", "Skills", "Projects", "Summary").
    * `"issue"` (string: specific issue identified).
    * `"recommendation"` (string: detailed, actionable recommendation for improvement).
    * `"example"` (string: brief example of rewrite/restructure, if applicable).

Format your entire output as a single, valid JSON object ONLY with the exact structure described above (using the specified field names like `matchScore`, `matchAnalysis`, etc.). Ensure your response contains NO explanatory text before or after the JSON object.
"""

    try:
        # Call Gemini with the prompt, requesting JSON response
        result_text = call_gemini_api(
            prompt=prompt,
            model=GEMINI_MODEL,
            temperature=0.2,
            response_mime_type="application/json"
        )

        # Basic cleaning attempt if Gemini includes markdown backticks
        if result_text.strip().startswith("```json"):
            result_text = result_text.strip()[7:]
        if result_text.strip().endswith("```"):
             result_text = result_text.strip()[:-3]
        result_text = result_text.strip()

        # Parse the returned JSON
        match_result_obj = json.loads(result_text, strict=False)

        # --- Validation and Defaulting ---
        required_fields = ["matchScore", "matchAnalysis", "keyStrengths",
                           "skillGaps", "jobRequirements", "resumeImprovements"]
        list_fields = ["keyStrengths", "skillGaps", "resumeImprovements"]
        dict_fields = ["jobRequirements"]

        for field in required_fields:
            if field not in match_result_obj:
                 print(f"Warning: Missing '{field}' in Gemini result. Adding default value.")
                 if field in list_fields:
                     match_result_obj[field] = []
                 elif field in dict_fields:
                      match_result_obj[field] = {}
                 elif field == "matchScore":
                       match_result_obj[field] = 0
                 else: # matchAnalysis
                       match_result_obj[field] = "[Analysis not provided]"

        # Validate job requirements structure more thoroughly
        job_req = match_result_obj.get("jobRequirements", {})
        if not isinstance(job_req, dict): job_req = {}
        job_req.setdefault("jobTitle", "[Job Title Not Extracted]")
        job_req.setdefault("requiredSkills", [])
        job_req.setdefault("experienceLevel", "Not specified")
        job_req.setdefault("educationNeeded", "Not specified")
        if not isinstance(job_req["requiredSkills"], list): job_req["requiredSkills"] = []
        match_result_obj["jobRequirements"] = job_req # Ensure validated object is set back

        # Ensure list fields are actually lists
        for field in list_fields:
            if not isinstance(match_result_obj.get(field), list):
                 print(f"Warning: Field '{field}' is not a list in Gemini result. Setting to empty list.")
                 match_result_obj[field] = []

        print(f"Gemini analysis complete. Match Score: {match_result_obj.get('matchScore')}")
        return match_result_obj

    except json.JSONDecodeError as e:
        print(f"Gemini analysis JSON decoding error: {e}. Response text (first 1000): {result_text[:1000]}")
        # Fallback: Return a structure indicating error
        return {
            "matchScore": 0,
            "matchAnalysis": f"[Error: Failed to parse analysis - {e}]",
            "keyStrengths": [], "skillGaps": [], "jobRequirements": {}, "resumeImprovements": [],
            "error": "Invalid JSON from Gemini"
        }
    except Exception as e:
        print(f"Gemini analysis error: {e}")
        traceback.print_exc()
         # Fallback: Return a structure indicating error
        return {
            "matchScore": 0,
            "matchAnalysis": f"[Error: Failed to generate analysis - {e}]",
            "keyStrengths": [], "skillGaps": [], "jobRequirements": {}, "resumeImprovements": [],
            "error": str(e)
        }



# --- Function to modify in backend.py ---
# Replace the existing generate_interview_prep_plan function

# --- Function to modify in backend.py ---
# Replace the existing generate_interview_prep_plan function

def generate_interview_prep_plan(resume_match_data):
    """
    Generates a personalized interview preparation plan based on resume-JD match analysis.
    Requests categorized questions with guidance and focuses on gap strategies.
    **REMOVED timeline generation from this function.**
    """
    print("--- Generating Prep Plan (Timeline Removed) ---")
    if not CLAUDE_API_KEY:
        raise ValueError("Claude API Key not configured.")

    # Extract relevant data (as before)
    match_score = resume_match_data.get("matchScore", 0)
    match_analysis = resume_match_data.get("matchAnalysis", "")
    skill_gaps = resume_match_data.get("skillGaps", [])
    job_requirements = resume_match_data.get("jobRequirements", {})
    parsed_resume = resume_match_data.get("parsedResume", {})

    # Convert to strings (as before)
    try:
        gaps_str = json.dumps(skill_gaps, indent=2)
        requirements_str = json.dumps(job_requirements, indent=2)
        resume_summary_str = json.dumps({
            "name": parsed_resume.get("name"),
            "currentPosition": parsed_resume.get("currentPosition"),
            "yearsOfExperience": parsed_resume.get("yearsOfExperience"),
            "technicalSkills": parsed_resume.get("technicalSkills", [])[:10]
        }, indent=2)
    except Exception as json_err:
        print(f"Warning: Could not serialize data for prep plan prompt - {json_err}")
        gaps_str = str(skill_gaps)
        requirements_str = str(job_requirements)
        resume_summary_str = str(parsed_resume.get("name", "Candidate"))


    # Build the updated prompt for Claude (Timeline section removed)
    system_prompt = f"""
You are an expert interview coach creating a personalized preparation plan for a job candidate based on their resume analysis against a job description.

Candidate Summary:
{resume_summary_str}

Job Requirements:
{requirements_str}

Identified Skill Gaps:
{gaps_str}

Analysis Summary:
- Match Score: {match_score}/100
- Overall Match Analysis: {match_analysis}

Create a comprehensive interview preparation plan **structured as a JSON object ONLY** with the following sections. Ensure valid JSON format with no extra text.

1.  **"focusAreas"**: List of 4-6 specific technical and non-technical topics the candidate MUST prioritize.
2.  **"likelyQuestions"**: Generate 15-20 specific questions the candidate will likely face. For EACH question, provide:
    * `"category"`: (string) Classify the question (e.g., "Technical - Python", "Technical - SQL", "Project Experience", "Behavioral - Teamwork", "Situational - Conflict", "Resume Specific").
    * `"question"`: (string) The interview question itself.
    * `"guidance"`: (string) Provide concise (1-2 sentences) SPECIFIC advice on HOW to best answer this particular question, tailored to the candidate's profile/job. Examples: "Highlight your experience with X from project Y.", "Use the STAR method, focusing on...", "Explain the trade-offs between A and B.", "Relate this to the job's requirement for Z.", "Emphasize your quick learning ability shown in...". Avoid generic advice.
3.  **"conceptsToStudy"**: Detailed breakdown of technical concepts, tools, or methodologies they should review based on job requirements AND identified gaps. Be specific.
4.  **"gapStrategies"**: For EACH gap listed in "Identified Skill Gaps" above, provide:
    * `"gap"`: (string) The specific skill or experience gap mentioned.
    * `"strategy"`: (string) Concrete advice on how to ADDRESS this gap during the interview. Suggest specific phrasing, focusing on positive framing, transferable skills, eagerness to learn, relevant projects/coursework, etc. Example: "Acknowledge lack of direct X experience, but pivot to your strong foundation in related Y and mention your recent Z certification/project..."
    * `"focus_during_prep"`: (string) What the candidate should specifically study or prepare related to this gap before the interview.

Your response MUST be only the valid JSON object described above. **DO NOT INCLUDE a 'preparationTimeline' section.**
""" # --- End Prompt ---

    messages = [{"role": "user", "content": "Generate the detailed interview preparation plan (excluding the timeline) based on the provided analysis."}]
    response_content = ""

    try:
        # Call Claude API (same logic as before)
        response_content = call_claude_api(
            messages=messages,
            system_prompt=system_prompt,
            model=CLAUDE_MODEL,
            max_tokens=4096, # Keep sufficient tokens for other sections
            temperature=0.5
        )
        print(f"Claude prep plan response received (first 500 chars): {response_content[:500]}")

        # Extract JSON (same logic as before)
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1

        if json_start >= 0 and json_end > json_start:
            json_text = response_content[json_start:json_end].strip()
            try:
                prep_plan = json.loads(json_text, strict=False)
                # Basic validation for key fields (as before)
                if "likelyQuestions" not in prep_plan or not isinstance(prep_plan.get("likelyQuestions"), list):
                    prep_plan["likelyQuestions"] = []
                if "gapStrategies" not in prep_plan or not isinstance(prep_plan.get("gapStrategies"), list):
                    prep_plan["gapStrategies"] = []
                # Ensure timeline is NOT present
                if "preparationTimeline" in prep_plan:
                    del prep_plan["preparationTimeline"]
                    print("Note: Removed unexpected 'preparationTimeline' from Claude response.")

                print("Prep plan (no timeline) generated and parsed successfully.")
                return prep_plan
            except json.JSONDecodeError as e:
                print(f"Prep plan JSON decoding error: {e}. Response text: {json_text[:1000]}")
                raise Exception("Claude API returned invalid JSON for prep plan.") from e
        else:
            print(f"Could not find JSON object in prep plan response: {response_content[:1000]}")
            raise Exception("Valid JSON object not found in prep plan response.")

    except Exception as e:
        print(f"Error generating interview prep plan (no timeline): {e}")
        traceback.print_exc()
        raise Exception(f"Failed to generate interview preparation plan: {str(e)}") from e


# --- NEW Function to Add to backend.py ---

def generate_dynamic_timeline_with_gemini(session_data, days):
    """
    Generates a dynamic, day-by-day interview preparation timeline using Gemini.
    """
    print(f"--- Generating Dynamic Timeline with Gemini ({days} days) ---")
    if not GEMINI_API_KEY:
        raise ValueError("Gemini API Key is not configured.")
    if not session_data:
        raise ValueError("Session data is required to generate timeline.")

    # --- Gather Context from Session Data ---
    prep_plan = session_data.get('results', {}).get('prep_plan', {})
    match_results = session_data.get('results', {}).get('match_results', {})
    parsed_resume = session_data.get('results', {}).get('parsed_resume', {})

    # Extract relevant parts safely
    focus_areas = prep_plan.get('focusAreas', [])
    concepts_to_study = prep_plan.get('conceptsToStudy', []) # Can be list or dict
    skill_gaps = match_results.get('skillGaps', [])
    job_title = match_results.get('jobRequirements', {}).get('jobTitle', 'the position')
    candidate_name = parsed_resume.get('name', 'Candidate')

    # Format context for the prompt
    try:
        focus_areas_str = "- " + "\n- ".join(focus_areas) if focus_areas else "N/A"
        # Handle concepts being list or dict
        if isinstance(concepts_to_study, dict):
            concepts_str = json.dumps(concepts_to_study, indent=2)
        elif isinstance(concepts_to_study, list):
            concepts_str = "- " + "\n- ".join(concepts_to_study) if concepts_to_study else "N/A"
        else:
            concepts_str = str(concepts_to_study) # Fallback
        gaps_str = json.dumps(skill_gaps, indent=2) if skill_gaps else "None identified."
    except Exception as json_err:
        print(f"Warning: Could not serialize context for timeline prompt - {json_err}")
        focus_areas_str = str(focus_areas)
        concepts_str = str(concepts_to_study)
        gaps_str = str(skill_gaps)

    # Limit context length
    focus_areas_limit = 1000
    concepts_limit = 2000
    gaps_limit = 1000

    # --- Construct Gemini Prompt ---
    prompt = f"""
Act as an expert interview coach. Create a detailed, actionable, day-by-day preparation timeline for {candidate_name} who is interviewing for a {job_title} position in {days} days.

**Context for Planning:**
* **Preparation Duration:** {days} days
* **Key Focus Areas:**
{focus_areas_str[:focus_areas_limit]}
* **Concepts to Study:**
{concepts_str[:concepts_limit]}
* **Identified Gaps to Address:**
{gaps_str[:gaps_limit]}

**Instructions:**
1.  Create a plan spanning exactly {days} days, plus a final entry for "Interview Day".
2.  For each day (Day 1 to Day {days}):
    * Define a clear `focus` for the day (e.g., "Core Python Concepts", "Behavioral STAR Practice", "Project Deep Dive").
    * Create a `schedule` (an array of objects) with specific tasks assigned to time slots (e.g., "Morning (2h)", "Afternoon (1h)", "Evening (1.5h)") or just list tasks sequentially.
    * Tasks should include: Reviewing specific `Concepts to Study`, practicing answering questions (mention categories like Technical/Behavioral), working on `Gap Strategies`, researching the company, reviewing the job description.
    * Distribute the `Focus Areas` and `Concepts to Study` review across the available days.
    * Include dedicated time slots for practicing behavioral questions using the STAR method, perhaps focusing on specific themes (teamwork, challenges).
    * Allocate time for reviewing resume/projects and preparing specific examples.
    * Include a short `notes` field for each day with encouragement or key reminders.
3.  For the "Interview Day" entry: Focus on relaxation, final quick review (max 30 mins), checking setup, and positive mindset.
4.  Optionally, estimate the `estimated_total_hours` required for the entire plan.
5.  Ensure the output is **ONLY a valid JSON object** with the following structure:

```json
{{
  "timeline": [
    {{
      "day": 1,
      "focus": "Example Focus",
      "schedule": [
        {{"time_slot": "Morning (Optional)", "task": "Specific task 1..."}},
        {{"time_slot": "Afternoon (Optional)", "task": "Specific task 2..."}}
      ],
      "notes": "Optional daily note."
    }},
    // ... objects for Day 2 through Day {days} ...
    {{
      "day": "Interview Day",
      "focus": "Execution & Confidence",
      "schedule": [
         {{"time_slot": "Morning", "task": "Light review (15-30 min max)."}},
         {{"time_slot": "Pre-Interview", "task": "Relax, check setup."}}
      ],
      "notes": "You're prepared!"
    }}
  ],
  "estimated_total_hours": <integer, optional>
}}
Ensure the JSON is complete and strictly follows this format. Do not include ```json markdown delimiters.
""" # End Prompt

    try:
        # Call Gemini API, requesting JSON
        result_text = call_gemini_api(
            prompt=prompt,
            model=GEMINI_MODEL, # Use Gemini
            temperature=0.5, # Allow some flexibility in scheduling
            response_mime_type="application/json"
        )

        # Basic cleaning attempt
        if result_text.strip().startswith("```json"):
            result_text = result_text.strip()[7:]
        if result_text.strip().endswith("```"):
            result_text = result_text.strip()[:-3]
        result_text = result_text.strip()

        # Parse JSON
        timeline_data = json.loads(result_text, strict=False)

        # Basic validation
        if "timeline" not in timeline_data or not isinstance(timeline_data.get("timeline"), list):
            print("Warning: 'timeline' key missing or not a list in Gemini response.")
            timeline_data = {"timeline": [], "error": "Generated timeline structure was invalid."}
        else:
            print(f"Dynamic timeline generated successfully ({len(timeline_data['timeline'])} entries).")

        return timeline_data

    except json.JSONDecodeError as e:
        print(f"Gemini timeline JSON decoding error: {e}. Response text (first 1000): {result_text[:1000]}")
        return {"timeline": [], "error": f"Failed to parse timeline JSON: {e}"}
    except Exception as e:
        print(f"Error generating dynamic timeline with Gemini: {e}")
        traceback.print_exc()
        return {"timeline": [], "error": f"Failed to generate timeline: {str(e)}"}



def create_mock_interviewer_prompt(resume_data, job_data, interview_type="general"):
    """
    Creates the system prompt for the AI interviewer based on the job and resume,
    incorporating a structured flow and emphasizing patience.
    """
    
    # Extract job details
    job_title = job_data.get("jobRequirements", {}).get("jobTitle", "the position")
    required_skills = job_data.get("jobRequirements", {}).get("requiredSkills", [])
    experience_level = job_data.get("jobRequirements", {}).get("experienceLevel", "")
    # Assuming job_description is available in job_data or can be passed if needed
    # job_description_summary = job_data.get("jobDescription", "")[:200] # Example: Use summary if available

    # Extract resume details
    candidate_name = resume_data.get("name", "the candidate")
    current_position = resume_data.get("currentPosition", "their background") # Adjusted default
    years_experience = resume_data.get("yearsOfExperience", "")
    skills = resume_data.get("technicalSkills", [])
    
    # Format lists for prompt
    skills_str = ", ".join(required_skills) if required_skills else "as specified in the job description"
    candidate_skills_str = ", ".join(skills) if skills else "the skills listed on their resume"
    experience_str = f" with {years_experience} of experience" if years_experience else ""

    # --- Structured Interview Flow ---
    structured_flow = f"""
You are an AI Interviewer designed to conduct realistic, structured mock interviews. You are interviewing {candidate_name} for a {job_title} role. The candidate has described their background as {current_position}{experience_str}.

**Core Interviewer Persona:**

- **Professional & Engaging:** Maintain a professional yet conversational and encouraging tone.
- **Patient:** VERY IMPORTANT - Allow the candidate ample time to think and respond. Wait for them to finish speaking, even if there are pauses, 'ums', or short breaks between sentences. Do NOT interrupt prematurely. Assume they might be thinking or structuring their answer.
- **Adaptive:** Ask relevant follow-up questions based on the candidate's responses to probe deeper, but stay within the current interview stage.
- **Objective:** Focus on assessing skills and fit based on the job requirements. Avoid personal opinions.
- **Concise:** Keep your questions and transitions relatively brief (1-3 sentences typically).

**Job Context:**

- Role: {job_title}
- Experience Level Sought: {experience_level}
- Key Skills Required: {skills_str}
- Candidate's Mentioned Skills: {candidate_skills_str}

**Mandatory Interview Structure:**

Follow this structure generally. Adapt the specific questions based on the candidate's profile, the job requirements, and the {interview_type} focus.

**Stage 1: Introduction & Rapport Building (1-2 questions)**

   1. Greet the candidate professionally, introduce yourself (as the AI interviewer), and state the purpose (mock interview for {job_title}).
   2. Ask an opening question like "Tell me about yourself" or "Can you walk me through your background/resume?".
   3. (Optional) Ask a brief question about their understanding of the role or company if relevant (especially for non-technical interviews or freshers).

**Stage 2: Experience & Foundational Knowledge (Varies based on {interview_type})**

   * If {interview_type} is 'technical' or 'general': Ask about their general experience, core skills relevant to the job ({skills_str}). Ask basic conceptual questions related to the required skills.
   * If {interview_type} is 'behavioral': Ask about past roles, team structures, general challenges faced.

**Stage 3: Technical Deep Dive / Skill Assessment (Major part for 'technical'/'general')**

   * Focus on the **Key Skills Required**: {skills_str}.
   * Ask specific technical questions, starting potentially easier and increasing complexity.
   * Present small scenarios or ask how they would approach a technical problem related to the role.
   * Validate skills mentioned on their resume ({candidate_skills_str}) that overlap with job requirements.
   * For coding questions, ask them to describe their logic, data structures, and approach rather than writing actual code in the chat.
   * Skip or minimize this stage if {interview_type} is purely 'behavioral'.

**Stage 4: Project Discussion / Accomplishments (Relevant for all types)**

   * Ask the candidate to discuss 1-2 significant projects from their resume or experience.
   * Focus on their specific contributions, challenges faced, technologies used, and outcomes.
   * Relate project experience back to the requirements of the {job_title} role.

**Stage 5: Behavioral & Situational Questions (Major part for 'behavioral', included in 'general')**

   * Ask questions to assess teamwork, problem-solving, communication, handling pressure, adaptability, etc.
   * Use STAR method prompts (e.g., "Tell me about a time when...", "Describe a situation where...").
   * Tailor questions to situations relevant to the {job_title} and {experience_level}. Examples: handling conflicting priorities, dealing with difficult colleagues/clients, learning new technologies quickly.
   * Include standard questions like "What are your strengths/weaknesses?" (ask for work-related examples) or "Where do you see yourself in 5 years?" (assess career goals).

**Stage 6: Candidate Questions & Logistics (1-2 questions from you)**

   * Briefly ask if the candidate has any questions for you (you can provide generic, safe answers about the mock process or suggest they focus on preparing questions for a real interview).
   * You might ask a simple logistical question if appropriate for the role context (e.g., "Are you comfortable with [aspect mentioned in JD like travel/location]?") - avoid salary.

**Stage 7: Closing & Next Steps (Your final response)**

   * Signal the end of the interview clearly.
   * Thank the candidate for their time.
   * Provide a brief, neutral or slightly positive closing remark (e.g., "Thank you for sharing your experience," or "It was interesting learning about your background."). Avoid giving detailed feedback here.
   * **Crucially:** Inform the candidate that a detailed performance analysis and feedback report will be available for them to review shortly after the session ends.
   * End the conversation professionally (e.g., "That concludes our mock interview. Best of luck with your preparation.")

**IMPORTANT Constraints:**

- **Adhere to the Flow:** Do not jump randomly between stages. Progress logically.
- **Patience is Key:** *Wait* for the candidate to finish. Do not interrupt.
- **Conciseness:** Keep your turns brief.
- **No Self-Answers:** Ask questions, don't provide the answers.
- **Stay In Character:** You are the interviewer, not a chatbot answering general queries.
- **No Detailed Feedback During Interview:** The analysis comes *after* the interview ends. Just give a brief closing remark.
"""

    # No need for separate type_specific sections anymore, as the structure incorporates the type focus.
    system_prompt = structured_flow
    return system_prompt


# --- UPDATED Function (Stricter Prompt for Analysis) ---
def analyze_interview_performance(interview_transcript, job_requirements, resume_data):
    """
    Analyzes the interview transcript and provides detailed feedback and scoring.
    Includes logic to handle potential JSON parsing issues from Claude API.
    Emphasizes basing scores on transcript interaction.
    """
    print("--- Starting Interview Analysis (Stricter Prompt Version) ---")
    analysis = {} # Initialize analysis dictionary
    json_text_raw = "" # To store the raw text before parsing attempt
    response_content = "" # To store the full Claude response

    try:
        # Format the job requirements and resume data for the prompt
        job_req_str = json.dumps(job_requirements, indent=2)
        resume_str = json.dumps(resume_data, indent=2)
        transcript_length = len(interview_transcript) # Get length for context

        # Limit input sizes for safety
        transcript_limit = 20000
        resume_limit = 5000
        job_req_limit = 2000

        system_prompt = f"""
You are an expert interview coach providing DETAILED and HONEST analysis of a mock interview transcript.
Review the following transcript and provide a comprehensive assessment based *primarily* on the interaction recorded.

Job Requirements:
{job_req_str[:job_req_limit]}

Candidate Resume Data (Provides Context ONLY):
{resume_str[:resume_limit]}

Interview Transcript (Length: {transcript_length} characters):
--- BEGIN TRANSCRIPT ---
{interview_transcript[:transcript_limit]}
--- END TRANSCRIPT ---

**VERY IMPORTANT SCORING INSTRUCTIONS:**
- Base the scores for `technicalAssessment`, `communicationAssessment`, and `behavioralAssessment` PRIMARILY on the candidate's answers, clarity, depth, and behavior demonstrated *within the provided transcript*.
- Do **NOT** give high scores based solely on the resume if the transcript lacks corresponding evidence of those skills or behaviors *during the interview*.
- If the transcript contains minimal interaction (e.g., only greetings, very short or no answers), the scores in the affected sections (Communication, Behavioral, Technical demonstration) **MUST** be low (e.g., 0-30 range) to reflect the lack of data from the conversation.
- The `overallAssessment` should clearly state if the evaluation is limited due to insufficient interaction in the transcript. Acknowledge the resume's potential but focus feedback on the *interview performance itself*.

Create a detailed analysis as a JSON object ONLY with the exact following structure. Do not include any text before or after the JSON object:

{{
  "overallScore": <integer between 0 and 100, reflecting transcript performance>,
  "overallAssessment": "<string assessment, 2-3 paragraphs, *explicitly mention if assessment is limited by short transcript*> ",
  "technicalAssessment": {{
    "score": <integer 0-100, *based on transcript evidence*>,
    "strengths": ["<string strength demonstrated *in transcript*>", ...],
    "weaknesses": ["<string weakness demonstrated *in transcript*>", ...],
    "feedback": "<string feedback on technical aspects *shown in transcript*>"
  }},
  "communicationAssessment": {{
    "score": <integer 0-100, *based on transcript evidence*>,
    "strengths": ["<string strength demonstrated *in transcript*, e.g., clarity, structure>", ...],
    "weaknesses": ["<string weakness demonstrated *in transcript*, e.g., brevity, vagueness, rambling>", ...],
    "feedback": "<string feedback on communication style *shown in transcript*>"
  }},
  "behavioralAssessment": {{
    "score": <integer 0-100, *based on transcript evidence*>,
    "strengths": ["<string strength demonstrated *in transcript*, e.g., STAR examples, handling questions>", ...],
    "weaknesses": ["<string weakness demonstrated *in transcript*, e.g., generic answers, lack of examples>", ...],
    "feedback": "<string feedback on behavioral aspects *shown in transcript*>"
  }},
  "specificFeedback": [ // Focus on actual question/answer pairs from transcript
    {{
      "question": "<string interviewer question *from transcript*>",
      "response": "<string candidate response summary *from transcript*>",
      "assessment": "<string feedback on *this specific* response>",
      "improvement": "<string suggestion for improving *this specific* response>"
    }},
    ...
  ],
  "keyImprovementAreas": [ // Derived from weaknesses observed *in transcript*
    {{
      "area": "<string area name, e.g., 'STAR Method Usage', 'Technical Depth on X'>",
      "recommendation": "<string detailed recommendation>",
      "practiceExercise": "<string specific exercise>"
    }},
    ...
  ]
}}
""" # End of system_prompt f-string

        messages = [{"role": "user", "content": "Analyze my interview performance based *primarily* on the provided transcript interaction, using the resume/job data only for context."}]

        # Call Claude API
        response_content = call_claude_api(
            messages=messages,
            system_prompt=system_prompt,
            model=CLAUDE_MODEL, # Ensure using a model capable of following complex instructions
            max_tokens=4096,
            temperature=0.4 # Keep temperature lower for more objective analysis
        )
        print(f"Claude analysis response received (first 500 chars): {response_content[:500]}")

        # --- JSON Parsing with Cleaning ---
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1

        if json_start != -1 and json_end != -1 and json_end > json_start:
            json_text_raw = response_content[json_start:json_end].strip()
            print("Attempting to parse extracted JSON object...")
            try:
                analysis = json.loads(json_text_raw, strict=False)
                print("Direct JSON parsing successful (using strict=False).")
            except json.JSONDecodeError as e1:
                print(f"Direct JSON parsing failed even with strict=False: {e1}.")
                print("--- Problematic Raw JSON Text ---")
                print(json_text_raw[:2000] + ('...' if len(json_text_raw) > 2000 else ''))
                print("---------------------------------")
                raise e1 # Re-raise the original error

        elif response_content.strip():
             print("Error: Could not find JSON object boundaries ('{'/'}') in Claude response.")
             print(f"--- Full Response (up to 2000 chars) ---")
             log_text = response_content[:2000] + ('...' if len(response_content) > 2000 else '')
             print(log_text)
             print("--------------------------------------")
             raise ValueError("Valid JSON object not found in Claude's response for analysis.")
        else:
            print("Error: Received empty or whitespace-only response from Claude for analysis.")
            raise ValueError("Claude returned an empty response for analysis.")

        if not analysis:
             raise ValueError("JSON parsing resulted in an empty analysis object.")

        print("Interview analysis generated successfully.")
        return analysis

    except json.JSONDecodeError as e:
        # Log the specific JSON parsing error and the raw text
        error_pos = getattr(e, 'pos', '?')
        error_msg = getattr(e, 'msg', 'Unknown JSON error')
        print(f"*** JSON Decode Error during analysis: {error_msg} at position {error_pos}")
        log_text = json_text_raw if json_text_raw else response_content
        if error_pos != '?':
             context_window = 30
             start = max(0, error_pos - context_window)
             end = min(len(log_text), error_pos + context_window)
             error_context = log_text[start:end]
             print(f"*** Context: ...{error_context}...")
        print(f"--- Raw Text that Failed Parsing (up to 2000 chars) ---")
        print(log_text[:2000] + ('...' if len(log_text) > 2000 else ''))
        print("---------------------------------------------")
        raise Exception("Failed to generate valid interview analysis due to JSON parsing error.") from e
    except Exception as e:
        print(f"Error during interview analysis generation: {e}")
        traceback.print_exc()
        raise Exception(f"An unexpected error occurred during analysis: {str(e)}") from e
# --- END UPDATED FUNCTION ---



def track_progress(user_id, interview_id, analysis_data):
    """
    Tracks progress across multiple mock interviews for the same user.
    Updates the progress_tracking dictionary with new analysis data.
    Returns the progress trend.
    """
    if user_id not in progress_tracking:
        progress_tracking[user_id] = {
            "interviews": [],
            "trends": {}
        }
    
    # Extract key metrics from the analysis
    metrics = {
        "date": datetime.now().isoformat(),
        "interviewId": interview_id,
        "overallScore": analysis_data.get("overallScore", 0),
        "technicalScore": analysis_data.get("technicalAssessment", {}).get("score", 0),
        "communicationScore": analysis_data.get("communicationAssessment", {}).get("score", 0),
        "behavioralScore": analysis_data.get("behavioralAssessment", {}).get("score", 0)
    }
    
    # Add to user's interview history
    progress_tracking[user_id]["interviews"].append(metrics)
    
    # Calculate trends if multiple interviews exist
    interviews = progress_tracking[user_id]["interviews"]
    if len(interviews) > 1:
        # Sort by date
        sorted_interviews = sorted(interviews, key=lambda x: x["date"])
        
        # Calculate improvements in each area
        first = sorted_interviews[0]
        latest = sorted_interviews[-1]
        
        trends = {
            "totalInterviews": len(interviews),
            "overallImprovement": latest["overallScore"] - first["overallScore"],
            "technicalImprovement": latest["technicalScore"] - first["technicalScore"],
            "communicationImprovement": latest["communicationScore"] - first["communicationScore"],
            "behavioralImprovement": latest["behavioralScore"] - first["behavioralScore"],
            "timespan": f"{(datetime.fromisoformat(latest['date']) - datetime.fromisoformat(first['date'])).days} days",
            "interviews": sorted_interviews  # Include all interview data for visualization
        }
        
        # Update trends in the progress tracking
        progress_tracking[user_id]["trends"] = trends
        return trends
    
    return {"totalInterviews": 1, "message": "First interview completed. Complete more interviews to track progress."}


def rewrite_resume_section(resume_data, job_description, section_to_improve):
    """
    Rewrites a specific section of the resume to better match the job description.
    """
    if not CLAUDE_API_KEY:
        raise ValueError("Claude API Key not configured.")
    
    # Format resume data for the prompt
    resume_str = json.dumps(resume_data, indent=2)
    
    # Build the prompt for Claude
    system_prompt = f"""
You are an expert resume writer helping a job seeker improve their resume for a specific job application.
Your task is to rewrite the "{section_to_improve}" section of their resume to better match the job requirements.

Resume Data (JSON):
{resume_str}

Job Description:
{job_description}

Section to Improve: {section_to_improve}

Provide a rewritten version of the {section_to_improve} section with the following characteristics:
1. More directly aligned with the job requirements
2. Emphasizes relevant skills and experiences
3. Uses strong action verbs and quantifiable achievements
4. Optimized for both human readers and ATS systems
5. Professional and concise language

Format your response as a JSON object with the following structure:
{{
  "original": "[current content from resume]",
  "improved": "[your rewritten content]",
  "explanations": [
    {{
      "change": "[specific change made]",
      "rationale": "[why this improves the resume]"
    }},
    ...
  ]
}}

Your response should be a valid JSON object only, with no additional explanation.
"""

    messages = [{"role": "user", "content": f"Please rewrite the {section_to_improve} section of my resume."}]
    
    try:
        # Call Claude API
        response_content = call_claude_api(
            messages=messages,
            system_prompt=system_prompt,
            model=CLAUDE_MODEL
        )
        
        # Parse the response as JSON
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1
        
        if json_start >= 0 and json_end > json_start:
            json_text = response_content[json_start:json_end]
            rewrite_result = json.loads(json_text)
        else:
            # If no JSON found, try to load the entire response
            rewrite_result = json.loads(response_content)
        
        return rewrite_result

    except json.JSONDecodeError as e:
        print(f"Rewrite JSON decoding error: {e}. Response: {response_content}")
        raise Exception("Failed to generate valid resume rewrite.")
    except Exception as e:
        print(f"Error rewriting resume section: {e}")
        raise

def generate_suggested_answers(transcript, resume_data, job_data):
    """
    Generates suggested answers for interviewer questions found in the transcript,
    tailored to the candidate's profile.
    """
    print("--- Generating Suggested Answers ---")
    if not CLAUDE_API_KEY:
        raise ValueError("Claude API Key not configured.")

    # Format resume and job data for the prompt
    resume_str = json.dumps(resume_data, indent=2)
    job_req_str = json.dumps(job_data.get("jobRequirements", {}), indent=2)
    skill_gaps_str = json.dumps(job_data.get("skillGaps", []), indent=2) # Include gaps for context

    system_prompt = f"""
You are an expert interview coach reviewing a mock interview transcript.
Your goal is to provide constructive feedback by suggesting strong alternative answers the candidate could have given.

Candidate Profile (from Resume):
{resume_str[:5000]} # Limit resume length in prompt

Job Requirements:
{job_req_str}

Identified Skill Gaps (for context):
{skill_gaps_str}

Interview Transcript:
--- BEGIN TRANSCRIPT ---
{transcript}
--- END TRANSCRIPT ---

Instructions:
1.  Identify ONLY the questions asked by the 'Interviewer'. Ignore candidate responses and general conversational filler.
2.  For each distinct Interviewer question identified:
    a.  Generate 1 or 2 distinct, well-structured, and strong example answers that *this specific candidate* could realistically give, based on their resume profile and aiming to address the job requirements.
    b.  Ensure the answers align with the candidate's likely experience level and skills. If addressing a skill gap, suggest how they might frame it positively (e.g., mentioning related experience, eagerness to learn).
    c.  For each suggested answer, provide a brief (1-sentence) 'rationale' explaining *why* it's a good answer (e.g., "Uses STAR method," "Highlights relevant skill X," "Quantifies achievement," "Addresses requirement Y directly," "Frames weakness constructively").
3.  Format your entire output as a single, valid JSON object ONLY, with no introductory text, explanations, or closing remarks. Use the following exact structure:

{{
  "suggestedAnswers": [
    {{
      "question": "<The exact question asked by the Interviewer>",
      "suggestions": [
        {{
          "answer": "<Example Answer 1 tailored to the candidate and job>",
          "rationale": "<Brief coaching rationale for Answer 1>"
        }},
        {{
          "answer": "<Optional Example Answer 2 tailored to the candidate and job>",
          "rationale": "<Brief coaching rationale for Answer 2>"
        }}
        // Add more suggestions if appropriate, but 1-2 is usually best
      ]
    }},
    // ... repeat for each identified Interviewer question
  ]
}}

Constraints:
- Focus only on Interviewer questions.
- Tailor answers to the provided candidate resume and job context.
- Keep rationales concise and focused on *why* the answer is effective.
- Ensure the final output is ONLY the JSON object.
""" # End of system_prompt f-string

    messages = [{"role": "user", "content": "Analyze the transcript and provide suggested answers for the interviewer questions based on the candidate's profile and job requirements."}]
    response_content = "" # Initialize

    try:
        response_content = call_claude_api(
            messages=messages,
            system_prompt=system_prompt,
            model=CLAUDE_MODEL, # Use a capable model like Sonnet
            max_tokens=4096,
            temperature=0.6 # Allow for some creativity in answers
        )
        print(f"Claude suggested answers response received (first 500 chars): {response_content[:500]}")

        # Attempt to parse JSON
        json_start = response_content.find('{')
        json_end = response_content.rfind('}') + 1
        if json_start != -1 and json_end != -1 and json_end > json_start:
            json_text_raw = response_content[json_start:json_end].strip()
            try:
                suggested_data = json.loads(json_text_raw, strict=False)
                # Basic validation
                if "suggestedAnswers" not in suggested_data or not isinstance(suggested_data["suggestedAnswers"], list):
                     print("Warning: 'suggestedAnswers' key missing or not a list in Claude response.")
                     suggested_data = {"suggestedAnswers": []} # Return empty structure
                print("Suggested answers generated and parsed successfully.")
                return suggested_data
            except json.JSONDecodeError as e:
                 print(f"*** JSON Decode Error for suggested answers: {e}")
                 print(f"--- Raw Text that Failed Parsing ---")
                 print(json_text_raw[:2000] + ('...' if len(json_text_raw) > 2000 else ''))
                 print("------------------------------------")
                 raise Exception("Failed to parse suggested answers JSON from Claude.") from e
        else:
            raise ValueError("Valid JSON object not found in Claude's response for suggested answers.")

    except Exception as e:
        print(f"Error generating suggested answers: {e}")
        # Optionally log the full response_content here if debugging
        # print(f"Full Claude response content on error:\n{response_content}")
        # Re-raise or return an error structure
        # For simplicity, we might return an empty structure on error
        # raise # Or re-raise the original error
        return {"suggestedAnswers": [], "error": f"Failed to generate suggestions: {str(e)}"}


# --- Flask Routes ---

@app.route('/analyze-resume', methods=['POST'])
def analyze_resume():
    """
    Analyzes a resume against a job description.
    Returns match score, analysis, and identified gaps.
    """
    try:
        if 'resumeFile' not in request.files:
            return jsonify({'error': 'No resume file in the request'}), 400
            
        resume_file = request.files['resumeFile']
        job_description = request.form.get('jobDescription')
        
        if not job_description:
            return jsonify({'error': 'Job description is required'}), 400
            
        if not resume_file or not resume_file.filename:
            return jsonify({'error': 'Invalid resume file'}), 400
            
        # Create a unique user session ID
        session_id = str(uuid.uuid4())
        
        # Create user session directory
        session_dir = os.path.join(BASE_TEMP_DIR, session_id)
        os.makedirs(session_dir, exist_ok=True)
        
        # Save resume file
        if resume_file.content_type == 'application/pdf' or resume_file.filename.lower().endswith('.pdf'):
            resume_path = os.path.join(session_dir, secure_filename(resume_file.filename))
            resume_file.save(resume_path)
        else:
            return jsonify({'error': 'Only PDF resume files are supported'}), 400
            
        # Process in the background
        def process_resume_background():
            try:
                # Initialize session status
                user_sessions[session_id] = {
                    'status': 'processing',
                    'progress': 10,
                    'resume_path': resume_path,
                    'job_description': job_description,
                    'start_time': datetime.now().isoformat(),
                    'results': {},
                    'errors': []
                }
                
                # 1. Extract text from PDF
                user_sessions[session_id]['progress'] = 20
                resume_text = extract_text_from_pdf(resume_path)
                
                # 2. Parse resume with Claude
                user_sessions[session_id]['progress'] = 40
                parsed_resume = parse_resume_with_claude(resume_text)
                user_sessions[session_id]['parsed_resume'] = parsed_resume
                
                # 3. Match resume with job description using Gemini
                user_sessions[session_id]['progress'] = 70
                match_results = match_resume_jd_with_gemini(parsed_resume, job_description)
                
                # 4. Generate interview preparation plan
                user_sessions[session_id]['progress'] = 90
                prep_plan = generate_interview_prep_plan(match_results)
                
                # Store results
                user_sessions[session_id]['results'] = {
                    'parsed_resume': parsed_resume,
                    'match_results': match_results,
                    'prep_plan': prep_plan
                }
                
                user_sessions[session_id]['status'] = 'completed'
                user_sessions[session_id]['progress'] = 100
                user_sessions[session_id]['end_time'] = datetime.now().isoformat()
                
            except Exception as e:
                print(f"Error processing resume: {e}")
                traceback.print_exc()
                user_sessions[session_id]['status'] = 'failed'
                user_sessions[session_id]['errors'].append(str(e))
                user_sessions[session_id]['end_time'] = datetime.now().isoformat()
        
        # Start background processing
        processing_thread = threading.Thread(target=process_resume_background)
        processing_thread.daemon = True
        processing_thread.start()
        
        return jsonify({
            'sessionId': session_id,
            'status': 'processing',
            'message': 'Resume analysis started'
        }), 202
        
    except Exception as e:
        print(f"Error in /analyze-resume: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/get-analysis-status/<session_id>', methods=['GET'])
def get_analysis_status(session_id):
    """
    Returns the current status of the resume analysis.
    """
    try:
        if session_id not in user_sessions:
            return jsonify({'error': 'Session not found or expired'}), 404
            
        session_data = user_sessions[session_id]
        
        response = {
            'sessionId': session_id,
            'status': session_data.get('status', 'unknown'),
            'progress': session_data.get('progress', 0),
            'startTime': session_data.get('start_time'),
            'endTime': session_data.get('end_time')
        }
        
        # Include results if analysis is completed
        if session_data.get('status') == 'completed':
            results = session_data.get('results', {})
            
            # Don't include the full parsed resume and match results in initial status
            # This keeps the response size smaller
            summary = {
                'name': results.get('parsed_resume', {}).get('name'),
                'matchScore': results.get('match_results', {}).get('matchScore'),
                'analysisComplete': True,
                'prepPlanComplete': 'prep_plan' in results
            }
            response['summary'] = summary
            
        # Include error if analysis failed
        if session_data.get('status') == 'failed':
            response['errors'] = session_data.get('errors', ['Unknown error occurred'])
        
        return jsonify(response)
        
    except Exception as e:
        print(f"Error in /get-analysis-status: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/get-full-analysis/<session_id>', methods=['GET'])
def get_full_analysis(session_id):
    """
    Returns the complete analysis results including match results and prep plan.
    """
    try:
        if session_id not in user_sessions:
            return jsonify({'error': 'Session not found or expired'}), 404
            
        session_data = user_sessions[session_id]
        
        if session_data.get('status') != 'completed':
            return jsonify({
                'status': session_data.get('status', 'unknown'),
                'progress': session_data.get('progress', 0),
                'message': 'Analysis not yet completed'
            }), 400
            
        results = session_data.get('results', {})
        
        return jsonify({
            'sessionId': session_id,
            'parsedResume': results.get('parsed_resume'),
            'matchResults': results.get('match_results'),
            'prepPlan': results.get('prep_plan')
        })
        
    except Exception as e:
        print(f"Error in /get-full-analysis: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/generate-dynamic-timeline', methods=['POST'])
def generate_dynamic_timeline_route():
    """
    Generates a dynamic interview preparation timeline based on user input.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON payload'}), 400

        session_id = data.get('sessionId')
        days_str = data.get('days') # Get days as string first

        if not session_id:
            return jsonify({'error': 'Session ID is required'}), 400
        if not days_str:
             return jsonify({'error': 'Number of days is required'}), 400

        # Validate days input
        try:
            days = int(days_str)
            if days <= 0 or days > 90: # Set reasonable limits (e.g., 1-90 days)
                 raise ValueError("Invalid number of days.")
        except ValueError:
             return jsonify({'error': 'Please enter a valid number of days (1-90).'}), 400

        # Retrieve session data
        if session_id not in user_sessions:
            return jsonify({'error': 'Session not found or expired'}), 404
        session_data = user_sessions[session_id]

        # Check if prep plan exists (needed for context)
        if not session_data.get('results', {}).get('prep_plan'):
             return jsonify({'error': 'Preparation plan must be generated first to provide context.'}), 400

        print(f"Request received for dynamic timeline: Session {session_id}, Days: {days}")

        # Call the Gemini generation function
        # Consider running this in a background thread if it takes too long
        timeline_result = generate_dynamic_timeline_with_gemini(session_data, days)

        # Check for errors returned by the generation function
        if "error" in timeline_result:
             # Use the error message from the generation function if available
             error_msg = timeline_result.get('error', 'Timeline generation failed.')
             print(f"Error generating dynamic timeline for session {session_id}: {error_msg}")
             return jsonify({'error': error_msg}), 500 # Return 500 for server-side generation failure

        return jsonify(timeline_result)

    except Exception as e:
        print(f"Error in /generate-dynamic-timeline route: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error generating timeline: {str(e)}'}), 500


@app.route('/rewrite-resume-section', methods=['POST'])
def rewrite_resume_section_route():
    """
    Rewrites a specific section of the resume to better match the job description.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON payload'}), 400
            
        session_id = data.get('sessionId')
        section = data.get('section')
        
        if not session_id or not section:
            return jsonify({'error': 'Session ID and section are required'}), 400
            
        if session_id not in user_sessions:
            return jsonify({'error': 'Session not found or expired'}), 404
            
        session_data = user_sessions[session_id]
        
        if session_data.get('status') != 'completed':
            return jsonify({'error': 'Resume analysis not yet completed'}), 400
            
        # Get resume data and job description from session
        resume_data = session_data.get('results', {}).get('parsed_resume')
        job_description = session_data.get('job_description')
        
        if not resume_data or not job_description:
            return jsonify({'error': 'Required data missing from session'}), 500
            
        # Call the rewrite function
        rewrite_result = rewrite_resume_section(resume_data, job_description, section)
        
        return jsonify(rewrite_result)
        
    except Exception as e:
        print(f"Error in /rewrite-resume-section: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/start-mock-interview', methods=['POST'])
def start_mock_interview():
    """
    Initializes a new mock interview session based on resume analysis.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON payload'}), 400
            
        session_id = data.get('sessionId')
        interview_type = data.get('interviewType', 'general')  # general, technical, behavioral
        
        if not session_id:
            return jsonify({'error': 'Session ID is required'}), 400
            
        if session_id not in user_sessions:
            return jsonify({'error': 'Session not found or expired'}), 404
            
        session_data = user_sessions[session_id]
        
        if session_data.get('status') != 'completed':
            return jsonify({'error': 'Resume analysis not yet completed'}), 400
            
        # Get required data from the session
        resume_data = session_data.get('results', {}).get('parsed_resume')
        job_data = session_data.get('results', {}).get('match_results')
        
        if not resume_data or not job_data:
            return jsonify({'error': 'Required data missing from session'}), 500
            
        # Create interview ID
        interview_id = str(uuid.uuid4())
        
        # Create interviewer system prompt
        system_prompt = create_mock_interviewer_prompt(resume_data, job_data, interview_type)
        
        # Initialize interview session
        interview_sessions[interview_id] = {
            'session_id': session_id,
            'interview_type': interview_type,
            'system_prompt': system_prompt,
            'conversation': [],
            'status': 'active',
            'start_time': datetime.now().isoformat(),
            'resume_data': resume_data,
            'job_data': job_data
        }
        
        # Generate initial greeting
        initial_prompt = f"You are starting an interview with {resume_data.get('name', 'the candidate')}. Give a brief, professional greeting and explain that this is a {interview_type} interview. Then ask your first question."
        
        try:
            greeting = call_claude_api(
                messages=[{"role": "user", "content": initial_prompt}],
                system_prompt=system_prompt,
                model=CLAUDE_MODEL
            )
            
            # Add to conversation
            interview_sessions[interview_id]['conversation'].append({
                'role': 'assistant',
                'content': greeting
            })
            
        except Exception as e:
            print(f"Error generating interview greeting: {e}")
            greeting = f"Hello, I'm your interviewer for today's {interview_type} interview. Let's get started with our discussion about your qualifications for this role. Could you briefly introduce yourself and your relevant experience?"
            interview_sessions[interview_id]['conversation'].append({
                'role': 'assistant',
                'content': greeting
            })
        
        return jsonify({
            'interviewId': interview_id,
            'sessionId': session_id,
            'interviewType': interview_type,
            'greeting': greeting
        })
        
    except Exception as e:
        print(f"Error in /start-mock-interview: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/interview-response', methods=['POST'])
def interview_response():
    """
    Processes user's spoken or typed response and returns the next interviewer question.
    """
    try:
        data = request.get_json()
        
        interview_id = data.get('interviewId')
        user_response = data.get('userResponse')
        
        if not interview_id:
            return jsonify({'error': 'Interview ID is required'}), 400
            
        if interview_id not in interview_sessions:
            return jsonify({'error': 'Interview session not found or expired'}), 404
            
        interview_data = interview_sessions[interview_id]
        
        if interview_data.get('status') != 'active':
            return jsonify({'error': 'Interview is not active'}), 400
            
        # Add user's response to conversation
        interview_data['conversation'].append({
            'role': 'user',
            'content': user_response
        })
        
        # Generate interviewer's next response
        try:
            interviewer_response = call_claude_api(
                messages=interview_data['conversation'],
                system_prompt=interview_data['system_prompt'],
                model=CLAUDE_MODEL
            )
            
            # Add to conversation
            interview_data['conversation'].append({
                'role': 'assistant',
                'content': interviewer_response
            })
            
        except Exception as e:
            print(f"Error generating interviewer response: {e}")
            interviewer_response = "I'm having trouble processing your response. Could you elaborate a bit more on your previous answer?"
            interview_data['conversation'].append({
                'role': 'assistant',
                'content': interviewer_response
            })
        
        return jsonify({
            'interviewerResponse': interviewer_response
        })
        
    except Exception as e:
        print(f"Error in /interview-response: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/process-audio', methods=['POST'])
def process_audio():
    """
    Processes audio from the user, transcribes it, and returns the transcription.
    """
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file in the request'}), 400
            
        audio_file = request.files['audio']
        interview_id = request.form.get('interviewId')
        
        if not audio_file or not audio_file.filename:
            return jsonify({'error': 'Invalid audio file'}), 400
            
        if not interview_id:
            return jsonify({'error': 'Interview ID is required'}), 400
            
        if interview_id not in interview_sessions:
            return jsonify({'error': 'Interview session not found or expired'}), 404
            
        # Read audio file
        audio_bytes = audio_file.read()
        
        # Transcribe audio
        transcribed_text = transcribe_audio(audio_bytes, audio_file.filename)
        
        return jsonify({
            'transcription': transcribed_text
        })
        
    except Exception as e:
        print(f"Error in /process-audio: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/generate-tts', methods=['POST'])
def generate_tts():
    """
    Generates speech from text using OpenAI TTS.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON payload'}), 400
            
        text = data.get('text')
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
            
        # Generate speech
        audio_content = generate_speech(text)
        
        # Convert to base64 for sending in JSON response
        audio_base64 = base64.b64encode(audio_content).decode('utf-8')
        
        return jsonify({
            'audioBase64': audio_base64
        })
        
    except Exception as e:
        print(f"Error in /generate-tts: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/end-interview', methods=['POST'])
def end_interview():
    """
    Ends the current interview and generates an analysis of the performance.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON payload'}), 400
            
        interview_id = data.get('interviewId')
        
        if not interview_id:
            return jsonify({'error': 'Interview ID is required'}), 400
            
        if interview_id not in interview_sessions:
            return jsonify({'error': 'Interview session not found or expired'}), 404
            
        interview_data = interview_sessions[interview_id]
        session_id = interview_data.get('session_id')
        
        # Mark interview as completed
        interview_data['status'] = 'completed'
        interview_data['end_time'] = datetime.now().isoformat()
        
        # Prepare for analysis
        conversation = interview_data['conversation']
        resume_data = interview_data['resume_data']
        job_data = interview_data['job_data']
        
        # Format transcript for analysis
        transcript = "\n".join([
            f"{'Interviewer' if msg['role'] == 'assistant' else 'Candidate'}: {msg['content']}"
            for msg in conversation
        ])
        
        # Start analysis in background
        def analyze_interview_background():
            try:
                interview_data['analysis_status'] = 'processing'
                
                # Generate analysis
                analysis = analyze_interview_performance(transcript, job_data, resume_data)
                
                # Store analysis in interview data
                interview_data['analysis'] = analysis
                interview_data['analysis_status'] = 'completed'
                
                # Track progress if session exists
                if session_id and session_id in user_sessions:
                    user_id = session_id  # Using session_id as user_id for now
                    progress_data = track_progress(user_id, interview_id, analysis)
                    interview_data['progress_tracking'] = progress_data
                
            except Exception as e:
                print(f"Error analyzing interview: {e}")
                traceback.print_exc()
                interview_data['analysis_status'] = 'failed'
                interview_data['analysis_error'] = str(e)
        
        # Start analysis thread
        analysis_thread = threading.Thread(target=analyze_interview_background)
        analysis_thread.daemon = True
        analysis_thread.start()
        
        return jsonify({
            'status': 'completed',
            'message': 'Interview ended and analysis started',
            'analysisStatus': 'processing'
        })
        
    except Exception as e:
        print(f"Error in /end-interview: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/get-interview-analysis/<interview_id>', methods=['GET'])
def get_interview_analysis(interview_id):
    """
    Returns the analysis of the completed interview.
    """
    try:
        if interview_id not in interview_sessions:
            return jsonify({'error': 'Interview session not found or expired'}), 404
            
        interview_data = interview_sessions[interview_id]
        
        if interview_data.get('status') != 'completed':
            return jsonify({'error': 'Interview is not completed'}), 400
            
        analysis_status = interview_data.get('analysis_status', 'not_started')
        
        if analysis_status == 'processing':
            return jsonify({
                'status': 'processing',
                'message': 'Analysis is still being generated'
            }), 202
            
        if analysis_status == 'failed':
            return jsonify({
                'status': 'failed',
                'error': interview_data.get('analysis_error', 'Unknown analysis error occurred')
            }), 500
            
        if analysis_status != 'completed' or 'analysis' not in interview_data:
            return jsonify({
                'status': 'not_available',
                'message': 'Analysis is not available'
            }), 400
            
        # Return the full analysis with transcript
        conversation = interview_data['conversation']
        formatted_transcript = [
            {
                'speaker': 'Interviewer' if msg['role'] == 'assistant' else 'Candidate',
                'text': msg['content']
            }
            for msg in conversation
        ]
        
        return jsonify({
            'analysis': interview_data['analysis'],
            'transcript': formatted_transcript,
            'progressTracking': interview_data.get('progress_tracking'),
            'interviewType': interview_data.get('interview_type'),
            'duration': get_duration(interview_data.get('start_time'), interview_data.get('end_time'))
        })
        
    except Exception as e:
        print(f"Error in /get-interview-analysis: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/get-suggested-answers/<interview_id>', methods=['GET'])
def get_suggested_answers_route(interview_id):
    """
    Generates and returns suggested 'ideal' answers for the interview questions.
    """
    try:
        if interview_id not in interview_sessions:
            return jsonify({'error': 'Interview session not found or expired'}), 404

        interview_data = interview_sessions[interview_id]

        if interview_data.get('status') != 'completed':
             return jsonify({'error': 'Interview analysis must be completed first'}), 400 # Or should it allow if transcript exists?

        # Get necessary data
        conversation = interview_data.get('conversation', [])
        resume_data = interview_data.get('resume_data')
        job_data = interview_data.get('job_data') # Contains job reqs etc. from match results

        if not conversation or not resume_data or not job_data:
             return jsonify({'error': 'Missing required data (transcript, resume, job) for generating suggestions'}), 500

        # Format transcript simply for the generation function
        transcript_text = "\n".join([
            f"{'Interviewer' if msg['role'] == 'assistant' else 'Candidate'}: {msg['content']}"
            for msg in conversation
        ])

        # Call the generation function (could be run in background if slow)
        suggestions = generate_suggested_answers(transcript_text, resume_data, job_data)

        return jsonify(suggestions)

    except Exception as e:
        print(f"Error in /get-suggested-answers: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error generating suggestions: {str(e)}'}), 500



@app.route('/get-progress-history/<session_id>', methods=['GET'])
def get_progress_history(session_id):
    """
    Returns the progress history across all interviews for a user.
    """
    try:
        if session_id not in user_sessions:
            return jsonify({'error': 'Session not found or expired'}), 404
            
        # Using session_id as user_id for now
        user_id = session_id
        
        if user_id not in progress_tracking:
            return jsonify({
                'message': 'No interview history found for this user',
                'interviews': []
            })
            
        return jsonify(progress_tracking[user_id])
        
    except Exception as e:
        print(f"Error in /get-progress-history: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


# --- Helper Endpoints ---

@app.route('/test', methods=['GET'])
def test_route():
    """Simple health check endpoint."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Check basic config status
    config_status = {
        "claude_ok": bool(CLAUDE_API_KEY),
        "gemini_ok": bool(GEMINI_API_KEY),
        "openai_ok": bool(OPENAI_API_KEY),
        "mistral_ok": bool(MISTRAL_API_KEY)
    }
    
    return jsonify({
        'status': 'ok',
        'message': f'Interview preparation backend server running at {now}',
        'config_status': config_status,
        'active_sessions': len(user_sessions),
        'active_interviews': len(interview_sessions)
    })


# --- Utility Functions ---

def get_duration(start_time_str, end_time_str):
    """Calculate duration between two ISO format datetime strings."""
    if not start_time_str or not end_time_str:
        return "N/A"
        
    try:
        start_time = datetime.fromisoformat(start_time_str)
        end_time = datetime.fromisoformat(end_time_str)
        duration_seconds = (end_time - start_time).total_seconds()
        
        # Format as minutes and seconds
        minutes = int(duration_seconds // 60)
        seconds = int(duration_seconds % 60)
        
        return f"{minutes}m {seconds}s"
    except Exception:
        return "N/A"


# --- Cleanup Functions ---

def cleanup_old_sessions():
    """Periodically cleans up old sessions to free memory."""
    while True:
        try:
            now = datetime.now()
            
            # Clean user sessions older than 24 hours
            for session_id in list(user_sessions.keys()):
                session = user_sessions[session_id]
                end_time = session.get('end_time')
                
                if end_time:
                    end_datetime = datetime.fromisoformat(end_time)
                    if (now - end_datetime).total_seconds() > 86400:  # 24 hours
                        # Clean up session files
                        session_dir = os.path.join(BASE_TEMP_DIR, session_id)
                        if os.path.exists(session_dir):
                            shutil.rmtree(session_dir)
                        
                        # Remove from memory
                        del user_sessions[session_id]
                        print(f"Cleaned up session {session_id}")
            
            # Clean interview sessions older than 24 hours
            for interview_id in list(interview_sessions.keys()):
                interview = interview_sessions[interview_id]
                end_time = interview.get('end_time')
                
                if end_time:
                    end_datetime = datetime.fromisoformat(end_time)
                    if (now - end_datetime).total_seconds() > 86400:  # 24 hours
                        # Remove from memory
                        del interview_sessions[interview_id]
                        print(f"Cleaned up interview {interview_id}")
            
        except Exception as e:
            print(f"Error in cleanup task: {e}")
            
        # Sleep for 1 hour before next cleanup
        time.sleep(3600)


# --- Main Execution ---
if __name__ == '__main__':
    print("-" * 60)
    print(f"Starting Interview Preparation Backend Server...")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Flask Port: {PORT}")
    print(f"Base Temporary Directory: {BASE_TEMP_DIR}")
    print("-" * 60)
    
    # Start cleanup thread
    cleanup_thread = threading.Thread(target=cleanup_old_sessions, daemon=True)
    cleanup_thread.start()
    
    # Run the Flask development server
    app.run(host='0.0.0.0', port=PORT, debug=True)
