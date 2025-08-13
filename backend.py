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
import razorpay
import hmac
from hmac import compare_digest
import hashlib


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
OPENAI_MODEL = "gpt-4o"  
GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/"
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions"
OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY") # Added based on original code
MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions" # Added based on original code
AWS_DEFAULT_REGION = os.environ.get("AWS_DEFAULT_REGION")
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET")
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET")
# AWS Keys might be needed if IAM role on Render doesn't work for Polly
# AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
# AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
# --- Boto3 import moved inside generate_speech_polly to avoid import error if not used ---

PORT = int(os.environ.get('PORT', 5000)) # Use Render's PORT env var
BASE_TEMP_DIR = tempfile.mkdtemp(prefix="iris_temp_") # For initial local save before Storage upload
# --- End Constants ---

# --- Firebase Admin SDK Initialization (Enhanced Check) ---
db = None
bucket = None
try:
    print("Attempting Firebase Admin SDK initialization...")
    service_account_json_str = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON')
    if service_account_json_str:
        service_account_info = json.loads(service_account_json_str)
        cred = credentials.Certificate(service_account_info)
        project_id = service_account_info.get('project_id')
        if not project_id:
             raise ValueError("Project ID not found in Firebase credentials.")

        print(f"Initializing Firebase App for project: {project_id}")
        firebase_admin.initialize_app(cred, {
            # We still pass storageBucket here for default behavior reference if needed
            'storageBucket': f"{project_id}.appspot.com"
        })
        print("Firebase App initialized successfully.")

        # --- Explicitly Check Bucket Existence ---
        try:
            print("Attempting to initialize Firestore client...")
            db = firestore.client()
            print("Firestore client initialized successfully.")

            print("Attempting to initialize Storage client and check bucket...")
            bucket_name_to_check = f"{project_id}.appspot.com"
            # Try getting the bucket object explicitly by name
            check_bucket = storage.bucket(name=bucket_name_to_check)

            # Use the exists() method to verify
            if check_bucket.exists():
                 print(f"INIT CHECK: Bucket '{check_bucket.name}' confirmed to EXIST via SDK.")
                 bucket = check_bucket # Assign the verified bucket object
                 print("Storage client assigned successfully.")
            else:
                 # This case should ideally not happen if the bucket truly exists
                 print(f"INIT CHECK: Bucket '{bucket_name_to_check}' reported as NOT FOUND via SDK exists() check!")
                 bucket = None # Ensure bucket is None

        except Exception as client_init_err:
             print(f"INIT CHECK: Error during Firestore/Storage client init or bucket check: {client_init_err}")
             traceback.print_exc()
             # Allow db to be initialized even if bucket check fails? Yes, for now.
             if not db: # If db also failed
                 db = None
             bucket = None # Ensure bucket is None on error

    else:
        print("CRITICAL ERROR: FIREBASE_SERVICE_ACCOUNT_JSON environment variable not set.")
        db = None
        bucket = None

except json.JSONDecodeError as e:
    print(f"CRITICAL ERROR: Failed to parse Firebase credentials from JSON string: {e}")
except ValueError as e:
     print(f"CRITICAL ERROR: Invalid Firebase credentials or missing project_id: {e}")
except Exception as e:
    print(f"CRITICAL ERROR: Unexpected error initializing Firebase Admin SDK: {e}")
    traceback.print_exc()
# --- End Firebase Initialization ---

# Get the absolute path to the directory where backend.py is located
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
# Define the absolute path to the 'public' folder
STATIC_FOLDER_PATH = os.path.join(BASE_DIR, 'public')

# Configure Flask to serve static files from that absolute path
app = Flask(__name__, static_folder=STATIC_FOLDER_PATH, static_url_path='')

# Update allowed_origin for deployed frontend later, use "*" for initial testing if needed, but be specific for production
allowed_origin = "*" # Use Render URL or custom domain later: os.environ.get("FRONTEND_URL", "*")
CORS(app, origins=[allowed_origin], supports_credentials=True)
# --- End Flask App Setup ---

# Initialize Razorpay client
razorpay_client = None
if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
    try:
        razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
        print("Razorpay client initialized successfully.")
    except Exception as e:
        print(f"Error initializing Razorpay client: {e}")
        traceback.print_exc()
else:
    print("WARNING: Razorpay credentials not set. Payment processing will not work.")


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
        # === CORRECTED LINE BELOW ===
        message = {'role': role, 'content': content, 'timestamp': datetime.now().isoformat()} # Use standard datetime string
        # === END CORRECTION ===
        interview_ref.update({
            'conversation': firestore.ArrayUnion([message]),
            'last_updated': firestore.SERVER_TIMESTAMP # This top-level one is fine
        })
        # Optional: Add logging on success
        # print(f"[{interview_id}] Added '{role}' message to conversation.")
        return True
    except Exception as e:
        print(f"ERROR: Failed to add message to interview {interview_id}: {e}")
        # Check if it's the specific TypeError
        if isinstance(e, TypeError) and 'Cannot convert to a Firestore Value' in str(e):
             print(f"[{interview_id}] Likely caused by nested timestamp issue during ArrayUnion.")
        return False
# === Existing Helper Functions (Keep implementations as they were) ===

def extract_text_from_pdf(file_path):
    """Extracts text from a PDF file given a local file path."""
    # This is the simpler version handling only local paths
    pdf_source_description = f"local file: {file_path}"
    print(f"Attempting to extract text from {pdf_source_description}")
    try:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Local file not found: {file_path}")

        reader = PdfReader(file_path)
        text = "".join([page.extract_text() + "\n" for page in reader.pages if page.extract_text()])

        print(f"Extracted {len(text)} characters from {pdf_source_description}.")
        if not text.strip():
             print(f"Warning: No text extracted from {pdf_source_description}")
        return text.strip()

    except FileNotFoundError as e:
         print(f"ERROR: PDF source not found - {e}")
         raise
    except Exception as e:
        print(f"ERROR extracting text from {pdf_source_description}: {e}")
        traceback.print_exc()
        raise Exception(f"Failed to extract text from PDF source: {e}") from e

def call_claude_api(messages, system_prompt, model=CLAUDE_MODEL, temperature=0.7, max_tokens=4096, current_time_str=None):
    """Calls the Claude API with specified parameters, optionally injecting current time."""
    if not CLAUDE_API_KEY: raise ValueError("Claude API Key is not configured.")
    
    # Filter out system messages if they exist in the messages list
    user_assistant_messages = [msg for msg in messages if msg.get("role") != "system"]
    if not user_assistant_messages:
        # Add a placeholder if the conversation history is empty
        user_assistant_messages = [{"role": "user", "content": "<BEGIN_INTERVIEW>"}]

    # --- Inject Current Time into System Prompt (Optional) ---
    final_system_prompt = system_prompt
    if current_time_str:
        if "[Current Time Context]" in final_system_prompt:
             final_system_prompt = final_system_prompt.replace("[Current Time Context]", f"Current time is approximately {current_time_str}.")
        else:
            # Fallback: Prepend the time info if no placeholder found
            final_system_prompt = f"(Current time is approximately {current_time_str})\n\n{system_prompt}"
    # --- End Time Injection ---

    print(f"--- Calling Claude ({model}) with Temp: {temperature} ---")
    
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": user_assistant_messages,
        "system": final_system_prompt, # Use the potentially modified prompt
        "temperature": temperature
    }
    headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": CLAUDE_API_KEY
    }
    try:
        response = requests.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload, timeout=90)
        print(f"Claude API response status: {response.status_code}")
        response.raise_for_status()
        response_data = response.json()
        content_blocks = response_data.get("content", [])
        if not content_blocks: raise Exception(f"Claude API response missing 'content'. Data: {response_data}")

        claude_response_text = "".join([block.get("text", "") for block in content_blocks if block.get("type") == "text"])

        # Check if the response text is empty or only whitespace
        if not claude_response_text.strip():
            print(f"Warning: Claude API returned empty text content. Blocks: {content_blocks}")
            return "[IRIS encountered an issue generating a response. Please try again.]"

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

def call_openai_api(prompt, model=OPENAI_MODEL, temperature=0.4):
    if not OPENAI_API_KEY: raise ValueError("OpenAI API Key not configured.")
    
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": 5000
    }
    
    try:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_API_KEY}"
            },
            json=payload,
            timeout=120  # Increased timeout
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]
    except requests.exceptions.RequestException as e:
        print(f"OpenAI API request error: {e}")
        if hasattr(e, 'response') and e.response is not None: 
            print(f"Status: {e.response.status_code}, Body: {e.response.text[:500]}")
        raise Exception(f"OpenAI API request failed: {e}") from e
    except Exception as e:
        print(f"OpenAI API Error: {e}")
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
    
    # NEW: Detect if this is a law-related resume (India-specific terms)
    law_keywords = ['law', 'legal', 'advocate', 'lawyer', 'litigation', 'judge', 'magistrate', 'court', 'judicial', 'legal advisor', 'legal counsel', 'law clerk', 'legal assistant', 'high court', 'supreme court', 'district court', 'sessions court', 'family court', 'civil court', 'criminal court', 'bar council', 'llb', 'll.b', 'llm', 'll.m', 'bachelor of law', 'master of law', 'law college', 'law university', 'law school', 'legal studies', 'jurisprudence', 'legal intern', 'legal trainee']
    
    is_law_domain = any(keyword.lower() in resume_text.lower() for keyword in law_keywords)
    
    # NEW: Domain-specific instructions
    if is_law_domain:
        domain_instructions = """
For legal resumes, pay special attention to:
- Legal specializations (Criminal Law, Civil Law, Corporate Law, Family Law, Constitutional Law, etc.)
- Indian legal education (LLB, LLM, BA LLB, BBA LLB from Indian law colleges/universities)
- Legal internships and clerkships (High Court, Supreme Court, law firms, legal aid societies)
- Bar Council enrollment and practice certificates
- Legal research projects, moot court competitions, legal aid work
- Knowledge of Indian legal framework (IPC, CrPC, CPC, Indian Constitution, etc.)
- Court appearances, case handling experience, legal drafting skills
- For "technicalSkills", include legal research tools, case management software, legal databases
- For "frameworks", include legal procedures, court systems, legal methodologies
- Extract legal certifications, bar admissions, specialized legal training"""
        
        skills_guidance = """For "technicalSkills", include: Legal research methods, Case analysis, Legal drafting, Court procedures, Client counseling, Negotiation skills, Legal databases (Manupatra, SCC Online, etc.), Case management software, Legal writing, Statutory interpretation, etc."""
        
        frameworks_guidance = """For "frameworks", include: Indian legal system, Criminal justice system, Civil procedure, Corporate legal framework, Family court procedures, Alternative dispute resolution, Legal ethics framework, etc."""
    else:
        domain_instructions = """
For technical/general resumes, focus on standard professional elements like work experience, technical skills, projects, education, and certifications."""
        
        skills_guidance = """For "technicalSkills", include programming languages, tools, software, platforms, and technical competencies."""
        
        frameworks_guidance = """For "frameworks", include software frameworks, methodologies, architectural patterns, and technical approaches."""

    system_prompt = f"""
You are an expert resume parser. Analyze this resume text:
--- START ---
{resume_text[:30000]}
--- END ---

{domain_instructions}

Extract the following information and return it as a valid JSON object only (no explanations):
{{
"name": "...", "email": "...", "phoneNumber": "...", "location": "...",
"yearsOfExperience": "...", "technicalSkills": [...], "companiesWorkedAt": [...],
"projects": [...], "education": [...], "languages": [...], "frameworks": [...],
"certifications": [...], "otherRelevantInfo": "...", "currentPosition": "...",
"hasSummarySection": true/false
}}

For "yearsOfExperience", follow these steps:
1. Look for explicit statements like "X years of experience" in the resume
2. If not found, calculate total years across all work experiences based on start and end dates
3. For current positions, calculate up to the present date
4. Round to the nearest whole number or use ranges like "2-3 years" if appropriate
5. If it's less than 1 year, use "<1" or "less than 1 year"
6. If you cannot determine the exact years, infer from job titles (e.g., "Senior" typically requires 5+ years, {"Senior Advocate" typically requires 10+ years" if is_law_domain else ""})
7. If there is no work experience section or only {"internships/academic projects/moot courts" if is_law_domain else "internships/academic projects"}, set as "fresher" or "0"

{skills_guidance}

{frameworks_guidance}

Set "hasSummarySection" to true if there is a summary or professional profile paragraph at the beginning of the resume (typically 2-5 lines describing {"legal expertise and experience" if is_law_domain else "skills and experience"}). If a field is not found, use null, "", or []. Ensure name, email, phoneNumber are present if found.
"""
    messages = [{"role": "user", "content": "Parse this resume."}]
    try:
        response_content = call_claude_api(
            messages=messages, system_prompt=system_prompt,
            model=CLAUDE_MODEL, temperature=0.2
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
        parsed_json.setdefault("hasSummarySection", False)  # Default to false if not provided
        # ... add other setdefaults if needed ...
        print("Resume parsed successfully by Claude.")
        return parsed_json
    except json.JSONDecodeError as e:
        print(f"Claude resume parsing JSON error: {e}. Response: {response_content[:500]}")
        raise Exception("Claude API returned invalid JSON during resume parsing.") from e
    except Exception as e:
        print(f"Claude resume parsing error: {e}")
        raise

def match_resume_jd_with_openai(resume_data, job_description):
    """Matches resume (JSON) with job description using OpenAI to produce specific, actionable improvements."""
    print("--- Matching Resume/JD with OpenAI (Requesting Specific Improvements) ---")
    # Ensure OPENAI_API_KEY is configured
    if not globals().get("OPENAI_API_KEY"): raise ValueError("OpenAI API Key is not configured.")

    # NEW: Detect if this is a law-related matching (India-specific terms)
    resume_data_str = json.dumps(resume_data, indent=2) if isinstance(resume_data, dict) else str(resume_data)
    
    law_keywords = ['law', 'legal', 'advocate', 'lawyer', 'litigation', 'judge', 'magistrate', 'court', 'judicial', 'legal advisor', 'legal counsel', 'law clerk', 'legal assistant', 'high court', 'supreme court', 'district court', 'sessions court', 'family court', 'civil court', 'criminal court']
    
    # Check both job description and resume data for law-related content
    is_law_domain = any(keyword.lower() in job_description.lower() for keyword in law_keywords) or \
                    any(keyword.lower() in resume_data_str.lower() for keyword in law_keywords)

    # Create sections overview for easier reference
    sections_overview = ""
    if isinstance(resume_data, dict):
        for key, value in resume_data.items():
            if key in ["projects", "education", "workExperience", "skills", "certifications", "languages"]:
                if isinstance(value, list):
                    sections_overview += f"- {key}: Contains {len(value)} entries\n"
                elif value:
                     sections_overview += f"- {key}: Present\n"
            elif key == "summary" and value:
                 sections_overview += f"- {key}: Present\n"
    
    # Add indicator if summary section is detected
    if resume_data.get("hasSummarySection") == True:
        sections_overview += "- summary: Present (Detected in introduction paragraph)\n"

    # NEW: Domain-specific analysis instructions
    if is_law_domain:
        domain_context = """
LEGAL DOMAIN CONTEXT: This is an Indian legal position analysis. Focus on:
- Indian legal qualifications (LLB, LLM, Bar Council enrollment)
- Indian legal experience (High Court, Supreme Court, District Court experience)
- Indian legal specializations (Criminal Law, Civil Law, Corporate Law, Family Law, Constitutional Law)
- Knowledge of Indian legal framework (IPC, BNSS, BNS, CrPC, CPC, Indian Constitution, Evidence Act, Contract Act, etc.)
- Indian legal skills (Case analysis, Legal drafting, Court appearances, Client counseling in Indian context)
- Indian legal certifications and continuing legal education
- Experience with Indian legal procedures and court systems"""
        
        skills_focus = """Focus on legal knowledge gaps such as: specific areas of Indian law, court procedures, legal research methods, case law knowledge, statutory interpretation, legal drafting skills, client management, courtroom advocacy, Indian legal technology platforms."""
        
        improvement_focus = """For legal resumes, prioritize improvements that highlight:
- Specific Indian legal expertise and case handling experience
- Knowledge of relevant Indian statutes and landmark judgments
- Court appearance experience and advocacy skills
- Legal research and writing capabilities in Indian legal context
- Client counseling and case management experience
- Specialization in relevant areas of Indian law"""
    else:
        domain_context = """
TECHNICAL/GENERAL DOMAIN CONTEXT: This is a standard professional position analysis. Focus on technical skills, work experience, projects, and industry-relevant qualifications."""
        
        skills_focus = """Focus on technical or professional skill gaps based on the job requirements such as: programming languages, frameworks, tools, certifications, methodologies, industry experience."""
        
        improvement_focus = """For technical/professional resumes, prioritize improvements that highlight:
- Relevant technical skills and project experience
- Quantifiable achievements and impact
- Industry-specific knowledge and certifications
- Problem-solving capabilities and innovation
- Leadership and collaboration experience"""

    prompt = f"""
Act as an expert AI resume writer and career coach with 15+ years of experience, specializing in tailoring resumes for competitive roles.
Your task is to perform a rigorous analysis of the provided resume against the job description and generate SPECIFIC, DETAILED, and ACTIONABLE improvements.

{domain_context}

Job Description:
--- START JD ---
{job_description[:10000]}
--- END JD ---

Candidate Resume Data (JSON):
--- START JSON ---
{resume_data_str[:10000]}
--- END JSON ---

Resume Sections Overview:
{sections_overview}

CRITICAL TASK: Perform a detailed analysis and return ONLY a valid JSON object adhering precisely to the structure and minimum count requirements specified below.

JSON Output Structure:
{{
  "matchScore": integer (0-100, honest assessment of CURRENT fit based *only* on provided data),
  "matchAnalysis": string (MUST be **at least 4-5 detailed paragraphs**. Discuss specific alignments and mismatches between resume sections and JD requirements. Quantify alignment where possible),
  "keyStrengths": array of objects (MUST contain **at least 5 distinct strengths** from the resume) [
    {{
      "strength": "<Specific {"legal expertise, case experience, or legal achievement" if is_law_domain else "skill, experience, or achievement"} from resume>",
      "relevance": "<Detailed explanation connecting this strength *directly* to a specific requirement or keyword in the Job Description>",
      "howToEmphasize": "<Concrete suggestion on making this strength more prominent or impactful in the resume>"
    }}
  ],
  "skillGaps": array of objects (MUST identify **at least 3 distinct skill gaps** based on JD qualifications) [
    {{
      "missingSkill": "<Specific required or preferred {"legal knowledge/expertise" if is_law_domain else "skill/experience"} from JD NOT EVIDENT in the resume>",
      "importance": "high/medium/low" (Based on JD emphasis),
      "suggestion": "<Actionable advice on how to address this gap>",
      "alternateSkillToHighlight": "<Identify a related {"legal skill or experience" if is_law_domain else "skill"} the candidate *does* possess that could partially compensate>"
    }}
  ],
  "jobRequirements": object {{
    "jobTitle": "<Accurately extracted Job Title from JD>",
    "requiredSkills": ["<List of specific key {"legal areas/expertise" if is_law_domain else "skills"} explicitly stated as required in JD>"],
    "experienceLevel": "<Required years/level (e.g., '5+ years', 'Senior Level', 'Entry Level')>",
    "educationNeeded": "<Minimum education requirements mentioned in JD>"
  }},
  "resumeImprovements": array of objects (MUST contain **at least 5 distinct improvements**, with **at least 3 targeting 'workExperience' or 'projects' sections**) [
    {{
      "section": "<Specific resume section (e.g., 'workExperience[0].description', 'projects[1].bulletPoints', 'summary', 'skills')>",
      "issue": "<Precise problem with the current content (e.g., 'Vague description lacks {"case details" if is_law_domain else "metrics"}', 'Bullet point uses weak verb')>",
      "recommendation": "<Detailed, specific change needed>",
      "currentContent": "<Exact text snippet from the resume that needs changing>",
      "improvedVersion": "<COMPLETE rewritten version of the content, ready to copy-paste>",
      "explanation": "<Explain *precisely why* this improvement makes the candidate a stronger fit for this specific {"legal position" if is_law_domain else "job"}>"
    }}
  ]
}}

{skills_focus}

{improvement_focus}

MANDATORY INSTRUCTIONS:
1. Every improvement must be SPECIFIC to THIS resume and THIS job description, not generic advice.
2. For `resumeImprovements.improvedVersion`, provide the FULLY rewritten text, not just instructions or partial edits.
3. Ensure all recommendations directly align with keywords and requirements from the job description.
4. Focus on improvements that add {"case details, legal impact, relevant legal keywords" if is_law_domain else "quantifiable results, impact, relevant keywords"}, and stronger alignment with the Job description.
5. Use strong action verbs and incorporate {"case outcomes/legal impact" if is_law_domain else "metrics/quantifiable achievements"} whenever possible.
"""

    try:
        result_text = call_openai_api(prompt=prompt, model=OPENAI_MODEL, temperature=0.2)
        # Clean potential markdown backticks
        if result_text.strip().startswith("```json"): result_text = result_text.strip()[7:]
        if result_text.strip().endswith("```"): result_text = result_text.strip()[:-3]

        match_result_obj = json.loads(result_text.strip(), strict=False)

        # Enhanced validation & defaulting
        match_result_obj.setdefault("matchScore", 0)
        match_result_obj.setdefault("matchAnalysis", "[Analysis not provided or failed validation]")
        match_result_obj.setdefault("keyStrengths", [])
        match_result_obj.setdefault("skillGaps", [])
        match_result_obj.setdefault("jobRequirements", {})
        match_result_obj.setdefault("resumeImprovements", [])

        # Validate list items
        def validate_list_items(items, required_keys, list_name):
            validated_list = []
            if not isinstance(items, list):
                 print(f"Warning: '{list_name}' is not a list in the response. Defaulting to empty list.")
                 return []
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    print(f"Warning: Item {i} in '{list_name}' is not an object. Skipping.")
                    continue
                for key in required_keys:
                    item.setdefault(key, f"[Missing: {key}]")
                validated_list.append(item)
            return validated_list

        match_result_obj["keyStrengths"] = validate_list_items(
            match_result_obj["keyStrengths"],
            ["strength", "relevance", "howToEmphasize"],
            "keyStrengths"
        )
        match_result_obj["skillGaps"] = validate_list_items(
            match_result_obj["skillGaps"],
            ["missingSkill", "importance", "suggestion", "alternateSkillToHighlight"],
            "skillGaps"
        )
        match_result_obj["resumeImprovements"] = validate_list_items(
            match_result_obj["resumeImprovements"],
            ["section", "issue", "recommendation", "currentContent", "improvedVersion", "explanation"],
            "resumeImprovements"
        )
        
        # If resume already has a summary section, remove any suggestions to add one
        if resume_data.get("hasSummarySection") == True:
            match_result_obj["resumeImprovements"] = [
                imp for imp in match_result_obj["resumeImprovements"] 
                if not (imp["section"] == "summary" and "lack" in imp["issue"].lower())
            ]

        print(f"OpenAI analysis complete. Match Score: {match_result_obj.get('matchScore')}, Strengths: {len(match_result_obj.get('keyStrengths', []))}, Gaps: {len(match_result_obj.get('skillGaps', []))}, Improvements: {len(match_result_obj.get('resumeImprovements', []))}")
        return match_result_obj
    except Exception as e:
        print(f"OpenAI analysis error: {e}")
        traceback.print_exc()
        return {"error": str(e), "matchScore": 0, "matchAnalysis": f"[Error during analysis: {e}]", "keyStrengths": [], "skillGaps": [], "jobRequirements": {}, "resumeImprovements": []}
        
def generate_interview_prep_plan(resume_match_data):
    """Generates a personalized interview prep plan using Claude (no timeline)."""
    print("--- Generating Prep Plan (No Timeline) ---")
    # Ensure CLAUDE_API_KEY is configured - replace with your actual check
    if not globals().get("CLAUDE_API_KEY"): raise ValueError("Claude API Key is not configured.")

    # Extract context safely
    match_score = resume_match_data.get("matchScore", 0)
    match_analysis = resume_match_data.get("matchAnalysis", "[Analysis not available]")
    skill_gaps = resume_match_data.get("skillGaps", [])
    job_requirements = resume_match_data.get("jobRequirements", {})
    # Assuming parsedResume might be added elsewhere or passed in resume_match_data
    parsed_resume = resume_match_data.get("parsedResume", {})
    if not parsed_resume and "resume_data" in resume_match_data: # Fallback if parsedResume isn't top-level
        parsed_resume = resume_match_data["resume_data"]

    # NEW: Detect if this is a law-related prep plan (India-specific terms)
    job_title = job_requirements.get("jobTitle", "")
    required_skills = job_requirements.get("requiredSkills", [])
    current_position = parsed_resume.get("currentPosition", parsed_resume.get("workExperience", [{}])[0].get("jobTitle", ""))
    
    law_keywords = ['law', 'legal', 'advocate', 'lawyer', 'litigation', 'judge', 'magistrate', 'court', 'judicial', 'legal advisor', 'legal counsel', 'law clerk', 'legal assistant', 'high court', 'supreme court', 'district court', 'sessions court', 'family court', 'civil court', 'criminal court']
    is_law_domain = any(keyword.lower() in job_title.lower() for keyword in law_keywords) or \
                    any(keyword.lower() in ' '.join(required_skills).lower() for keyword in law_keywords) or \
                    any(keyword.lower() in current_position.lower() for keyword in law_keywords)

    try:
        gaps_str = json.dumps(skill_gaps, indent=2) if skill_gaps else "[]"
        requirements_str = json.dumps(job_requirements, indent=2) if job_requirements else "{}"
        # Extract only basic info for summary to keep prompt concise
        resume_summary_dict = {
            "name": parsed_resume.get("name", parsed_resume.get("contactInfo", {}).get("name")),
            "currentPosition": parsed_resume.get("currentPosition", parsed_resume.get("workExperience", [{}])[0].get("jobTitle")),
            "yearsOfExperience": parsed_resume.get("yearsOfExperience", "[Not specified]"),
            "technicalSkillsSummary": [s.get("skill") for s in parsed_resume.get("skills", []) if s.get("type") == "TECHNICAL"][:10] # Sample of tech skills
        }
        resume_summary_str = json.dumps(resume_summary_dict, indent=2)

    except Exception as json_err:
        print(f"Warning: Could not serialize data cleanly for prep plan prompt - {json_err}")
        gaps_str, requirements_str, resume_summary_str = str(skill_gaps), str(job_requirements), str(parsed_resume) # Fallback to string

    # NEW: Domain-specific question guidance and concepts structure
    if is_law_domain:
        question_guidance = """CRITICAL: This list MUST contain **at least 13 legal knowledge/fundamental questions** directly related to Indian law requirements (from `jobRequirements`) and the candidate's `skillGaps`. Include **only 1-2 behavioral questions**. Focus on:
        - **Indian Penal Code (IPC)** sections and applications
        - **Bharatiya Nagarik Suraksha Sanhita (BNSS)** provisions (replacing CrPC)
        - **Bharatiya Nyaya Sanhita (BNS)** provisions (replacing IPC for new cases)
        - **Indian Constitution** articles and amendments
        - **Code of Civil Procedure (CPC)** and criminal procedure knowledge
        - **Indian Evidence Act** provisions
        - **Indian Contract Act, 1872**
        - **Transfer of Property Act, 1882**
        - **Hindu Marriage Act, 1955** and other Indian personal laws
        - **Supreme Court and High Court** landmark Indian judgments
        - Indian legal terminology and statutory interpretations"""
        
        concepts_structure = """
  "conceptsToStudy": {{
    "fundamentals": [Array of essential Indian legal concepts like basic IPC sections, Constitutional articles, fundamental rights, legal procedures],
    "advanced": [Array of complex Indian legal topics like advanced constitutional law, complex statutory interpretations, landmark case analyses],
    "technologies": [Array of Indian legal databases, case management systems, legal research tools used in Indian practice],
    "methodologies": [Array of Indian legal processes like case preparation methods, court procedures, legal drafting techniques, client counseling approaches]
  }},"""
    else:
        question_guidance = """CRITICAL: This list MUST contain **at least 13 technical/fundamental questions** directly related to the job's required skills (from `jobRequirements`) and the candidate's `skillGaps`. Include **only 1-2 behavioral questions**."""
        
        concepts_structure = """
  "conceptsToStudy": {{
    "fundamentals": [Array of essential baseline concepts the candidate must be comfortable with],
    "advanced": [Array of more complex topics that would demonstrate expertise],
    "technologies": [Array of specific tools, libraries, frameworks mentioned in or related to the JD],
    "methodologies": [Array of processes, approaches, or methodologies relevant to the role]
  }},"""

    # --- Start of Modified Prompt ---
    system_prompt = f"""
You are an expert interview coach tasked with creating a highly targeted interview preparation plan. Base your plan *strictly* on the provided analysis data.

Candidate Summary:
{resume_summary_str[:1000]}

Job Requirements:
{requirements_str[:2000]}

Identified Skill Gaps:
{gaps_str[:1500]}

Analysis Summary: Match Score: {match_score}/100. {match_analysis[:1500]}

Your Task: Create a detailed preparation plan structured ONLY as a valid JSON object. Adhere precisely to the specified structure and content requirements below.

JSON Output Structure:
{{
  "focusAreas": [Array of 4-6 specific {"legal concepts, Indian law areas, or behavioral aspects" if is_law_domain else "technical concepts, skills, or behavioral areas"} MOST critical for success in this interview, derived from JD and gaps],
  "likelyQuestions": [Array of **exactly 15 to 20** question objects. {question_guidance} For each question, provide tailored guidance.],{concepts_structure}
  "gapStrategies": [Array containing one object for EACH identified skill gap from the input. If no gaps were identified, provide an empty array `[]`.]
}}

Detailed Structure Definitions:
- "likelyQuestions": Each object must be `{{"category": "{"Legal Knowledge/Behavioral/Situational" if is_law_domain else "Technical/Behavioral/Situational"}", "question": "<Specific interview question>", "guidance": "<1-2 sentences of SPECIFIC, actionable advice on how to approach *this* question, referencing candidate's potential experience or gaps>"}}`.
- "gapStrategies": Each object must be `{{"gap": "<The missingSkill from the input>", "strategy": "<Concrete advice on how to address this gap during the interview (e.g., {'Highlight case study X which involved similar legal area Y', 'Discuss relevant law coursework Z', 'Reference internship experience with similar legal procedures' if is_law_domain else 'Highlight project X which used related tech Y', 'Discuss relevant coursework Z', 'Acknowledge gap and express eagerness to learn'})>", "focus_during_prep": "<Specific {'legal topic/statute/case law' if is_law_domain else 'topic/skill'} to study beforehand to mitigate this gap>"}}`.

MANDATORY INSTRUCTIONS:
1.  **Strict Question Count & Mix:** Generate exactly 15-20 questions total for `likelyQuestions`. At least 13 must be {"legal knowledge/fundamental" if is_law_domain else "technical/fundamental"}, max 2 behavioral.
2.  **JSON Only:** Your response MUST be ONLY the valid JSON object described above. No introductory text, explanations, apologies, or markdown formatting.
3.  **No Timeline:** **DO NOT INCLUDE** any form of timeline or schedule (e.g., `preparationTimeline`).
4.  **Relevance:** All content MUST be directly derived from the provided context (Summary, Requirements, Gaps, Analysis).
5.  **Specificity:** Guidance, concepts, and strategies must be concrete and actionable, not generic.
"""
    # --- End of Modified Prompt ---

    messages = [{"role": "user", "content": "Generate the detailed interview preparation plan (excluding timeline) strictly following the JSON structure and content rules provided in the system prompt."}]
    response_content = ""
    try:
        response_content = call_claude_api( # Assume call_claude_api exists
            messages=messages, system_prompt=system_prompt, model=CLAUDE_HAIKU_MODEL,
            max_tokens=4096, temperature=0.5
        )

        # --- Robust JSON extraction ---
        json_text = ""
        try:
            # Try parsing directly first
            prep_plan = json.loads(response_content, strict=False)
        except json.JSONDecodeError:
            # If direct parsing fails, find JSON block
            json_start = response_content.find('{')
            json_end = response_content.rfind('}') + 1
            if json_start != -1 and json_end != -1 and json_end > json_start:
                json_text = response_content[json_start:json_end].strip()
                try:
                    # Try basic repair if needed
                    opening_braces = json_text.count('{')
                    closing_braces = json_text.count('}')
                    opening_brackets = json_text.count('[')
                    closing_brackets = json_text.count(']')
                    
                    # Add missing closing braces/brackets if needed
                    if opening_braces > closing_braces:
                        json_text += '}' * (opening_braces - closing_braces)
                        print(f"Added {opening_braces - closing_braces} missing closing braces to JSON")
                    
                    if opening_brackets > closing_brackets:
                        json_text += ']' * (opening_brackets - closing_brackets)
                        print(f"Added {opening_brackets - closing_brackets} missing closing brackets to JSON")
                    
                    prep_plan = json.loads(json_text, strict=False)
                    print("Successfully extracted and parsed JSON after repair.")
                except json.JSONDecodeError as e_inner:
                    print(f"Prep plan JSON decoding error after extraction and repair: {e_inner}. Response text slice: {json_text[:1000]}")
                    raise ValueError(f"Valid JSON object not found or parsable in prep plan response: {response_content[:1000]}") from e_inner
            else:
                 raise ValueError(f"Valid JSON object markers not found in prep plan response: {response_content[:1000]}")

        # --- Validation and Cleanup ---
        if not isinstance(prep_plan, dict):
             raise ValueError("Extracted content is not a JSON object.")

        prep_plan.setdefault("focusAreas", [])
        prep_plan.setdefault("likelyQuestions", [])
        
        # Update the conceptsToStudy initialization to match the new structure
        if "conceptsToStudy" not in prep_plan or not isinstance(prep_plan["conceptsToStudy"], dict):
            prep_plan["conceptsToStudy"] = {
                "fundamentals": [],
                "advanced": [],
                "technologies": [],
                "methodologies": []
            }
        else:
            # Ensure all required fields exist
            prep_plan["conceptsToStudy"].setdefault("fundamentals", [])
            prep_plan["conceptsToStudy"].setdefault("advanced", [])
            prep_plan["conceptsToStudy"].setdefault("technologies", [])
            prep_plan["conceptsToStudy"].setdefault("methodologies", [])
            
        prep_plan.setdefault("gapStrategies", [])

        # Ensure no timeline sneaked in
        if "preparationTimeline" in prep_plan:
            del prep_plan["preparationTimeline"]
            print("Warning: Removed 'preparationTimeline' found in response.")

        # Validate question count and rough mix (optional but good)
        q_count = len(prep_plan.get("likelyQuestions", []))
        if not (15 <= q_count <= 20):
             print(f"Warning: Generated question count ({q_count}) is outside the target range (15-20).")
        # Add more detailed validation if needed (e.g., check question object structure)

        print(f"Prep plan (no timeline) generated successfully. Questions: {q_count}")
        return prep_plan

    except json.JSONDecodeError as e: # Catch errors from the primary attempt if extraction wasn't needed
        print(f"Prep plan JSON decoding error: {e}. Full response: {response_content[:1000]}")
        raise Exception("Claude API returned invalid JSON for prep plan.") from e
    except ValueError as e: # Catch errors from extraction/validation logic
        print(f"Prep plan generation error: {e}")
        # Optionally re-raise or return error structure
        raise Exception(f"Failed to generate valid prep plan JSON: {str(e)}") from e
    except Exception as e:
        print(f"Error generating interview prep plan (no timeline): {e}")
        traceback.print_exc()
        # Return a consistent error structure if needed, or re-raise
        raise Exception(f"Failed to generate prep plan: {str(e)}") from e

def generate_dynamic_timeline_with_openai(session_data, days):
    """Generates a dynamic, day-by-day interview prep timeline using OpenAI."""
    print(f"--- Generating Dynamic Timeline with OpenAI ({days} days) ---")
    # Ensure OPENAI_API_KEY is configured - replace with your actual check
    if not globals().get("OPENAI_API_KEY"): raise ValueError("OpenAI API Key is not configured.")
    if not session_data: raise ValueError("Session data is required to generate timeline.")

    # Safely extract necessary data from session_data
    prep_plan = session_data.get('results', {}).get('prep_plan', {})
    match_results = session_data.get('results', {}).get('match_results', {})
    # Fallback for resume data location
    parsed_resume_results = session_data.get('results', {}).get('parsed_resume', {})
    parsed_resume_input = session_data.get('resume_data', {}) # Assuming resume_data might be top-level input
    parsed_resume = parsed_resume_results if parsed_resume_results else parsed_resume_input

    # NEW: Detect if this is a law-related timeline (India-specific terms)
    job_title = match_results.get('jobRequirements', {}).get('jobTitle', 'the position')
    required_skills = match_results.get('jobRequirements', {}).get('requiredSkills', [])
    current_position = parsed_resume.get('currentPosition', parsed_resume.get('workExperience', [{}])[0].get('jobTitle', ''))
    
    law_keywords = ['law', 'legal', 'advocate', 'lawyer', 'litigation', 'judge', 'magistrate', 'court', 'judicial', 'legal advisor', 'legal counsel', 'law clerk', 'legal assistant', 'high court', 'supreme court', 'district court', 'sessions court', 'family court', 'civil court', 'criminal court']
    is_law_domain = any(keyword.lower() in job_title.lower() for keyword in law_keywords) or \
                    any(keyword.lower() in ' '.join(required_skills).lower() for keyword in law_keywords) or \
                    any(keyword.lower() in current_position.lower() for keyword in law_keywords)

    focus_areas = prep_plan.get('focusAreas', [])
    concepts_to_study = prep_plan.get('conceptsToStudy', [])
    skill_gaps = match_results.get('skillGaps', []) # Expecting list of objects as defined before
    candidate_name = parsed_resume.get('name', parsed_resume.get('contactInfo', {}).get("name", 'Candidate'))

    # Prepare context strings carefully
    try:
        focus_areas_str = "- " + "\n- ".join(focus_areas) if focus_areas and isinstance(focus_areas, list) else "N/A"

        # Handle concepts_to_study being list or dict (or other)
        if isinstance(concepts_to_study, list):
            concepts_str = "- " + "\n- ".join(concepts_to_study) if concepts_to_study else "N/A"
        elif isinstance(concepts_to_study, dict):
             concepts_str = json.dumps(concepts_to_study, indent=2)
        else:
             concepts_str = str(concepts_to_study) if concepts_to_study else "N/A"

        # Format skill gaps for clarity in the prompt
        if skill_gaps and isinstance(skill_gaps, list):
             gaps_list_str = []
             for gap in skill_gaps:
                 gap_desc = gap.get('missingSkill', 'Unknown Gap')
                 gap_imp = gap.get('importance', 'medium')
                 gaps_list_str.append(f"- {gap_desc} (Importance: {gap_imp})")
             gaps_str = "\n".join(gaps_list_str) if gaps_list_str else "None identified."
        else:
            gaps_str = "None identified or data missing."

    except Exception as fmt_err:
        print(f"Warning: Could not format context cleanly for timeline prompt - {fmt_err}")
        focus_areas_str = str(focus_areas)
        concepts_str = str(concepts_to_study)
        gaps_str = str(skill_gaps)

    # NEW: Domain-specific task examples and focus areas
    if is_law_domain:
        task_examples = """Instead of 'Study X', use 'Review IPC Section 302 vs 304 distinctions', 'Analyze landmark Supreme Court judgment in [Specific Case]', 'Draft STAR answers for 2 likely legal questions about Constitutional Law expertise', 'Research Indian legal procedures for [Specific Court Type]', 'Practice explaining plea bargaining under BNSS', 'Study Transfer of Property Act provisions for property disputes'. Reference Indian legal concepts, statutes, and case law explicitly."""
        domain_focus = f"Indian legal knowledge for {job_title}"
    else:
        task_examples = """Instead of 'Study X', use 'Review [Specific Concept from Concepts list]', 'Implement [Specific Algorithm]', 'Draft STAR answers for 2 likely technical questions about [Specific Skill/Project]', 'Research [Company Name]'s approach to [Relevant Area]', 'Practice explaining [Concept related to a Skill Gap]'. Reference the Concepts/Gaps lists explicitly."""
        domain_focus = f"technical expertise for {job_title}"

    # --- Start of Modified Prompt ---
    prompt = f"""
Act as an expert interview coach designing a hyper-personalized, actionable preparation timeline.
The candidate, {candidate_name}, is interviewing for a {job_title} position and has {days} days to prepare.

Key Context for Planning:
* Preparation Duration: {days} days until the interview.
* Priority Focus Areas:
{focus_areas_str[:1000]}
* Specific {"Legal Concepts/Indian Statutes" if is_law_domain else "Concepts/Tools"} to Master:
{concepts_str[:2000]}
* Identified {"Legal Knowledge" if is_law_domain else "Skill"} Gaps to Address:
{gaps_str[:1000]}

Instructions: Create a detailed, day-by-day timeline from Day 1 to Day {days}, plus a final "Interview Day" plan.
Output ONLY a valid JSON object with the following structure:
{{
  "timeline": [
    {{
      "day": <integer | "Interview Day">,
      "focus": "<Primary theme or goal for the day (e.g., {'Deep Dive: IPC Criminal Law Review', 'Constitutional Law & Landmark Cases Practice', 'Legal Drafting & Court Procedure Simulation' if is_law_domain else 'Deep Dive: Core Algorithm Review', 'Behavioral Question Practice & Company Research'})>",
      "schedule": [
        {{
          "time_slot": "<Optional suggested time (e.g., 'Morning', 'Afternoon', '1 hour')>",
          "task": "<**Highly Specific Task**: Must be actionable. {task_examples}>"
        }}
        // Include multiple tasks per day, covering {"legal concepts, Indian statutes, case analysis, court procedures, legal drafting" if is_law_domain else "concepts, practice, gaps, research"} etc.
      ],
      "notes": "<Brief strategic advice or reminders for the day>"
    }}
    // Repeat structure for each day from 1 to {days}, and for "Interview Day"
  ],
  "estimated_total_hours": <integer, optional estimate of total prep time>
}}

CRITICAL REQUIREMENTS:
1.  **Task Specificity:** Each task in the 'schedule' MUST be concrete and reference specific items from the {'Legal Concepts/Indian Statutes' if is_law_domain else 'Concepts to Study'} or {'Legal Knowledge Gaps' if is_law_domain else 'Skill Gaps'} context provided above. Prioritize {"fundamental Indian legal concepts relevant to the position and legal knowledge gaps" if is_law_domain else "fundamental concepts relevant to the job and gaps"}.
2.  **Gap Integration:** Explicitly schedule tasks aimed at addressing the identified {'Legal Knowledge Gaps' if is_law_domain else 'Skill Gaps'}.
3.  **Daily Structure:** Provide entries for every day from 1 to {days}, plus one for "Interview Day".
4.  **Interview Day Focus:** Tasks for "Interview Day" should focus on light review, mental prep, logistics, and relaxation.
5.  **JSON Format Only:** The entire output must be a single, valid JSON object. No introductory text, explanations, or markdown. Ensure correct syntax, brackets, commas, and quotes.
"""
    # --- End of Modified Prompt ---

    try:
        result_text = call_openai_api(prompt=prompt, model=OPENAI_MODEL, temperature=0.5) # Assume call_openai_api exists

        # Clean potential markdown backticks
        if result_text.strip().startswith("```json"): result_text = result_text.strip()[7:]
        if result_text.strip().endswith("```"): result_text = result_text.strip()[:-3]

        # --- Robust JSON Parsing ---
        timeline_data = {}
        try:
            timeline_data = json.loads(result_text.strip(), strict=False)
        except json.JSONDecodeError as e_inner:
             print(f"OpenAI timeline JSON decoding error: {e_inner}. Response text (partial): {result_text[:1000]}")
             # Try to find JSON block if direct parse failed
             json_start = result_text.find('{')
             json_end = result_text.rfind('}') + 1
             if json_start != -1 and json_end != -1 and json_end > json_start:
                 json_text_extracted = result_text[json_start:json_end].strip()
                 try:
                     timeline_data = json.loads(json_text_extracted, strict=False)
                     print("Successfully parsed JSON after finding block.")
                 except json.JSONDecodeError as e_retry:
                     print(f"JSON decoding failed even after extracting block: {e_retry}. Extracted text (partial): {json_text_extracted[:1000]}")
                     # Set error state if retry fails
                     timeline_data = {"timeline": [], "error": f"Failed to parse timeline JSON after extraction: {e_retry}"}
             else:
                # Set error state if no JSON block found
                timeline_data = {"timeline": [], "error": f"Failed to parse timeline JSON, no valid block found: {e_inner}"}

        # --- Validation ---
        if not isinstance(timeline_data, dict) or "timeline" not in timeline_data:
            print("Error: 'timeline' key missing or root is not an object in OpenAI response.")
            # Ensure error key exists if structure is wrong
            timeline_data.setdefault("error", "Generated timeline structure was invalid.")
            timeline_data["timeline"] = [] # Ensure timeline key exists as list even on error
        elif not isinstance(timeline_data.get("timeline"), list):
             print("Warning: 'timeline' key exists but is not a list in OpenAI response.")
             timeline_data["timeline"] = [] # Reset to list if type is wrong
             timeline_data.setdefault("error", "'timeline' field was not a list.")
        else:
             # Optional: Deeper validation of timeline items
             for i, day_plan in enumerate(timeline_data["timeline"]):
                 if not isinstance(day_plan, dict) or "day" not in day_plan or "schedule" not in day_plan or not isinstance(day_plan.get("schedule"), list):
                     print(f"Warning: Invalid structure for timeline entry at index {i}. Day plan: {day_plan}")
                     # Could potentially remove invalid entries or mark them

             print(f"Dynamic timeline generated successfully ({len(timeline_data.get('timeline', []))} entries).")
             # Clear error if validation passes
             timeline_data.pop("error", None)

        # Ensure estimated_total_hours is handled correctly
        if "estimated_total_hours" in timeline_data and not isinstance(timeline_data["estimated_total_hours"], int):
             print(f"Warning: 'estimated_total_hours' is not an integer. Removing.")
             timeline_data.pop("estimated_total_hours", None)

        return timeline_data

    except Exception as e: # Catch broader errors
        print(f"Error generating dynamic timeline with OpenAI: {e}")
        traceback.print_exc()
        return {"timeline": [], "error": f"Failed to generate timeline due to exception: {str(e)}"}

# UPDATED function in backend.py (keeping ALL existing functionality + law support)
def create_mock_interviewer_prompt(resume_data, job_data, interview_type="general"):
    """
    Creates the system prompt for the AI interviewer (IRIS) with refined question structure
    and GENERALIZED technical question examples (v4 - Domain Agnostic + Law Support).
    """
    job_title = job_data.get("jobRequirements", {}).get("jobTitle", "the position")
    required_skills = job_data.get("jobRequirements", {}).get("requiredSkills", [])
    experience_level = job_data.get("jobRequirements", {}).get("experienceLevel", "")
    candidate_name = resume_data.get("name", "the candidate")
    current_position = resume_data.get("currentPosition", "their background")
    years_experience = resume_data.get("yearsOfExperience", "")
    candidate_skills = resume_data.get("technicalSkills", [])
    skill_gaps = job_data.get("skillGaps", []) # Get skill gaps from match results
    is_experienced = bool(years_experience and years_experience not in ["0", "fresher", "<1", "less than 1"]) # Simple check for experience

    # NEW: Detect if this is a law-related interview (India-specific terms)
    law_keywords = ['law', 'legal', 'advocate', 'lawyer', 'litigation', 'judge', 'magistrate', 'court', 'judicial', 'legal advisor', 'legal counsel', 'law clerk', 'legal assistant', 'high court', 'supreme court', 'district court', 'sessions court', 'family court', 'civil court', 'criminal court']
    is_law_domain = any(keyword.lower() in job_title.lower() for keyword in law_keywords) or \
                    any(keyword.lower() in ' '.join(required_skills).lower() for keyword in law_keywords) or \
                    any(keyword.lower() in current_position.lower() for keyword in law_keywords)

    # Format data for prompt
    skills_str = ", ".join(required_skills) if required_skills else "as specified in the job description"
    candidate_skills_str = ", ".join(candidate_skills) if candidate_skills else "no specific skills listed on resume"
    skill_gaps_str = ", ".join([gap.get('missingSkill', 'N/A') for gap in skill_gaps]) if skill_gaps else "None identified"
    experience_str = f" with {years_experience} of experience" if years_experience else " who seems to be relatively new or a fresher"

    # Make this explicit, especially for "general" type
    if interview_type == "general":
        technical_focus = True
        behavioral_focus = True
    else:
        technical_focus = interview_type in ["technical", "general"]
        behavioral_focus = interview_type in ["behavioral", "general"]

    # NEW: Domain-specific technical section
    if is_law_domain:
        technical_section = """
3.  **Legal Knowledge Assessment (EXACTLY 2 questions, REQUIRED FOR ALL INTERVIEW TYPES):** 
    ***Step 1: Analyze the specific legal areas mentioned in the job requirements** ({skills_str}) and create 5 questions based on these exact areas.
    ***Step 2: Formulate legal knowledge questions with this difficulty mix:**
    - 1 EASY question: Basic legal definitions, foundational legal concepts, or legal terminology related to the practice area
    - 3 MEDIUM questions: Core legal principles, statute applications, procedural knowledge, or case law understanding
    - 1 DIFFICULT question: Complex legal scenarios, comparative analysis of laws, or advanced jurisprudence
    
    ***Important:** Your questions MUST focus on pure legal knowledge of the specific areas ({skills_str}) rather than situational application. Questions should directly assess knowledge of:
    - **Indian Penal Code (IPC)** sections and applications
    - **Bharatiya Nagarik Suraksha Sanhita (BNSS)** provisions (replacing CrPC)
    - **Bharatiya Nyaya Sanhita (BNS)** provisions (replacing IPC for new cases)
    - **Indian Constitution** articles and amendments
    - **Code of Civil Procedure (CPC)** and **Code of Criminal Procedure** knowledge
    - **Indian Evidence Act** provisions
    - **Indian Contract Act, 1872**
    - **Transfer of Property Act, 1882**
    - **Hindu Marriage Act, 1955** and other personal laws
    - **Supreme Court and High Court** landmark judgments
    - **Legal definitions and terminology** as per Indian law
    - **Statutory interpretations** under Indian legal framework
    
    Examples of appropriate Indian legal knowledge questions:
    - "Which section of the IPC deals with criminal intimidation and how is it applied in Indian courts?"
    - "What is the difference between Section 302 and Section 304 of the IPC in the context of Indian criminal law?"
    - "Under BNSS, what are the provisions for plea bargaining and how do they differ from the old CrPC?"
    - "Explain the significance of Article 21 of the Indian Constitution in criminal jurisprudence"
    - "What is the procedure for filing a suit under Order VII of CPC?"
    - "How does the Indian Evidence Act define 'fact in issue' and 'relevant fact'?"
    
    Base each question directly on one of the legal areas in ({skills_str}), tailoring to the exact legal specialization. The questions should test knowledge that would be expected of any qualified legal professional in this exact role ({job_title}).
        """
        
        advanced_section = """
4.  **Case Analysis & Legal Problem-Solving (1 question, REQUIRED FOR ALL INTERVIEW TYPES):**
    * Ask 1-2 questions that require applying legal knowledge to complex scenarios or cases relevant to the specific legal role ({job_title}).
    * The questions should:
      - Present realistic legal scenarios that might be encountered in this specific role
      - Require legal reasoning and case analysis
      - Test the ability to identify legal issues and apply appropriate laws
      - Be appropriate to the candidate's experience level
    
    Examples: 
    - "A client approaches you claiming harassment by their neighbor under Indian law. Walk me through your legal analysis and the IPC sections you'd consider."
    - "In a case involving rash driving causing death under Indian criminal law, which IPC/BNS sections would apply and how would you build your argument in an Indian court?"
    - "How would you handle a property dispute case under the Transfer of Property Act, 1882 in an Indian district court?"
    - "A matrimonial dispute arises under the Hindu Marriage Act. What would be your approach and which Indian family court procedures would you follow?"
        """
        
        behavioral_section = """
6.  **Legal Behavioral Assessment (EXACTLY 2 questions, REQUIRED FOR ALL INTERVIEW TYPES):**
    * You MUST ask 2 behavioral questions, including:
      - ONE legal situational question relevant to Indian legal practice. Frame it as "Describe a situation where you had to [legal scenario, e.g., 'handle an ethical dilemma with a client under the Bar Council of India rules', 'manage a complex caseload in Indian courts under tight deadlines', 'deal with opposing counsel in a difficult negotiation in Indian legal context', 'present a case before an Indian judge or magistrate']? How did you approach it and what was the outcome?" (STAR method implicitly encouraged).
      - ONE question about legal strengths OR professional development, requesting a specific example (e.g., "What would you consider your greatest strength as a legal professional, and can you give an example of when it benefited a case or client?" or "Tell me about a time you had to quickly learn a new area of law or legal procedure. How did you approach it?") OR ONE forward-looking question like "Where do you see yourself in your legal career in the next 5 years?"
    * DO NOT SKIP these questions regardless of the interview type.
        """
    else:
        # Use the existing technical sections for non-law domains
        technical_section = """
3.  **Fundamental Technical Knowledge (EXACTLY 2 questions, REQUIRED FOR ALL INTERVIEW TYPES):** 
    ***Step 1: Analyze the specific skills listed in the job requirements** ({skills_str}) and create 5 questions based on these exact skills.
    ***Step 2: Formulate fundamental technical questions with this difficulty mix:**
    - 1 EASY question: Basic definitions, foundational concepts, or terminology related to a core skill
    - 3 MEDIUM questions: Core technical principles, common usage patterns, or standard implementations
    - 1 DIFFICULT question: Advanced concepts, trade-offs, optimizations, or deeper understanding
    
    ***Important:** Your questions MUST focus on pure technical fundamentals of the specific skills ({skills_str}) rather than situational application. Questions should directly assess knowledge of definitions, concepts, methods, functions, tools, techniques, syntax, features, or comparative understanding relevant to these precise skills.
    
    Base each question directly on one of the skills in ({skills_str}), tailoring to the exact field/domain. The questions should test knowledge that would be expected of any qualified professional in this exact role ({job_title}).
        """
        
        advanced_section = """
4.  **Advanced Application & Problem-Solving (1 question, REQUIRED FOR ALL INTERVIEW TYPES):**
    * Ask 1-2 questions that require applying knowledge to complex scenarios or problems relevant to the specific role ({job_title}).
    * The questions should:
      - Present realistic scenarios that might be encountered in this specific role
      - Require analytical thinking and decision-making
      - Test the ability to balance multiple factors or trade-offs
      - Be appropriate to the candidate's experience level
        """
        
        behavioral_section = """
6.  **Behavioral Assessment (EXACTLY 2 questions, REQUIRED FOR ALL INTERVIEW TYPES):**
    * You MUST ask 2 behavioral questions, including:
      - ONE situational question relevant to the job description. Frame it as "Describe a situation where you had to [scenario relevant to JD, e.g., 'manage conflicting priorities', 'deal with a difficult stakeholder', 'adapt to unexpected changes', 'learn a new complex skill quickly']? How did you approach it and what was the outcome?" (STAR method implicitly encouraged).
      - ONE question about strengths OR weaknesses, requesting a specific example (e.g., "What would you consider your greatest professional strength, and can you give an example of when it was beneficial?" or "Tell me about a time you identified a weakness in your skillset or approach and what steps you took to improve.") OR ONE forward-looking question like "Where do you see yourself professionally in the next 5 years?"
    * DO NOT SKIP these questions regardless of the interview type.
        """

    # --- Start of Modified System Prompt ---
    system_prompt = f"""
You are IRIS, an AI Interviewer. Your ONLY role is to conduct a realistic, structured, and concise mock interview for the specified `interview_type`. You must be strict in following instructions.

**Target Role:** {job_title} (Requires: {experience_level} experience, Skills: {skills_str})
**Candidate:** {candidate_name} ({current_position}{experience_str})
**Candidate Skills:** {candidate_skills_str}
**Identified Gaps:** {skill_gaps_str}
**Interview Type Focus:** '{interview_type}' (For a 'general' interview, you MUST cover ALL sections thoroughly)

**Critical Directives - Follow Strictly:**
* **Role Adherence:** You are ONLY the interviewer, IRIS. Do NOT provide feedback, hints, answers, or engage in off-topic chat. If the candidate's response is irrelevant or confusing, politely guide them back by repeating the last question or stating "My role is to ask questions for this mock interview. Let's return to..." and then ask the question again or the next planned question. Do NOT break character under any circumstances.
* **Question Cadence:** Ask **ONLY ONE** main question per turn. **DO NOT** ask multiple questions or list sub-questions (like 1, 2, 3) in a single turn. A single, brief, essential clarifying question (e.g., "Could you elaborate on that specific technique?") is permissible *only if necessary* after the candidate responds, but avoid this if possible.
* **Minimal Acknowledgements Only:** Do NOT provide summaries or evaluations of the candidate's answers during the interview (e.g., avoid "Excellent point", "That's a good approach"). You MAY use very brief, neutral acknowledgements like "Okay.", "Understood.", "Noted." before transitioning.
* **Varied Transitions:** Transition smoothly to the next question using varied, concise phrases. Avoid repeating the same transition (e.g., "Given your experience..."). Use alternatives like "Okay, let's move on to...", "Building on that...", "Next, I'd like to ask about...", "Understood. Now, regarding...", "Let's shift focus to...".
* **Candidate Comfort:** If the candidate struggles significantly, stammers, or explicitly says 'I don't know', provide brief, reassuring encouragement. Say ONLY ONE of the following: 'Take your time to think.', 'No problem, we can come back to this if you'd like.', or 'That's okay, let's move to the next question.' Then proceed according to their response or move to the next planned question.
* **Pacing and Length:** You MUST ask a MINIMUM of 13 questions total before closing. The entire interview should consist of approximately 13-15 questions total and conclude within 30-40 total conversation turns (including candidate responses). Move promptly between phases after covering the necessary questions for that phase based on the '{interview_type}'. Do not linger.

**Mandatory Interview Flow (You MUST cover ALL sections for a 'general' interview):**

1.  **Introduction (1 question, REQUIRED):**
    * Greet appropriately (consider time context provided externally). Introduce yourself ("I am IRIS...") and state the purpose (mock interview for {job_title}, focusing on '{interview_type}' aspects).
    * Ask ONLY: "To start, could you please tell me a bit about yourself and your background?"

2.  **Experience / Projects (1 questions, REQUIRED):**
    * **(If Experienced):** Ask about a relevant previous role OR achievement. Then ask about ONE significant project (contribution OR challenge OR outcome), focusing questions based on '{interview_type}'.
    * **(If Inexperienced):** Ask about ONE significant academic or personal project (motivation OR role OR technique OR challenge OR learning), focusing questions based on '{interview_type}'. Ask one follow-up about a specific aspect if needed.

{technical_section}

{advanced_section}

5.  **Skill Gap Exploration (1 question, REQUIRED):**
    * If a relevant skill gap ({skill_gaps_str}) exists, politely ask ONE question related to it (e.g., "The role involves [Gap Skill]. Can you share your familiarity or experience with it?").
    * If the candidate clearly states they lack the skill or knowledge, acknowledge neutrally ('Okay, thank you for letting me know.') and move on.
    * If their answer is vague or suggests superficial knowledge, you *may* ask ONE follow-up question to probe deeper (e.g., 'Could you give an example of how you've used a similar skill or technology?' or 'How would you approach learning [Gap Skill] for this role?'). Limit this phase to max 1 question total.

{behavioral_section}

7.  **HR / Logistics (1 question, REQUIRED):**
    * **(If JD mentions relocation):** Ask ONE question: "The job description mentions potential relocation. Is that something you're open to discussing?"
    * **(If JD mentions salary/negotiation OR if candidate brings it up):** Ask ONE initial question: "Regarding compensation, do you have any initial expectations you'd like to share for a role like this?"
        * **Negotiation Handling:** If the candidate provides a number or range that seems high or warrants discussion, engage briefly (1-2 exchanges MAX). You could ask: "Could you help me understand how you arrived at that figure based on your experience and this role's scope?" or state "Our initial budget for this role is closer to [mention a slightly lower range or point]. Is there any flexibility in your expectations?".
        * **Concluding Negotiation:** After 1 exchange, conclude neutrally. If the negotiation seemed somewhat positive, you *might* say: "Okay, thank you for sharing. We might have some flexibility, perhaps towards [mention a slightly increased figure or reaffirm the range], but final compensation is determined later in the process based on the overall interview performance." If not positive or settled, say: "Okay, noted. We'll keep that in mind. Compensation is typically finalized after all interview stages." ALWAYS end the salary discussion here. SKIP this entire salary section if not mentioned in JD and not raised by candidate.
    * Ask ONLY: "Do you have any brief questions for me about this mock interview process itself?" (Answer generically about the mock process ONLY, not about the job or feedback).

8.  **Closing (Fixed Statements, REQUIRED):**
    * Transition: "Okay, that covers the main areas for this '{interview_type}' focused session."
    * Statement 1: "Thank you for your time today, {candidate_name}."
    * Statement 2: "A detailed analysis report of this mock interview, including feedback and suggestions based on our conversation, will be available to you shortly after we conclude."
    * Statement 3: "This concludes our mock interview. We wish you the best in your preparation." (End conversation here).

**CRITICAL REQUIREMENTS:**
1. You MUST ask a MINIMUM of 8 questions total before closing.
2. For 'general' interviews, you MUST include ALL question types as specified above.
3. The {"5 legal knowledge questions" if is_law_domain else "5 fundamental technical questions"} MUST be directly based on the specific {"legal areas" if is_law_domain else "skills"} ({skills_str}) mentioned for the role.
4. Tailor all questions to the exact domain, field, and requirements of the role ({job_title}).
5. Ask exactly ONE question per turn, maintain strong structure, and follow the interview flow in order.
6. Adapt question difficulty and complexity based on the candidate's experience level.
"""
    # --- End of Modified System Prompt ---

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

    # Extract minimal resume data to save tokens
    resume_summary = {
        "name": resume_data.get("name", ""),
        "currentPosition": resume_data.get("currentPosition", ""),
        "yearsOfExperience": resume_data.get("yearsOfExperience", ""),
        "technicalSkills": resume_data.get("technicalSkills", [])[:5]  # Limit skills
    }
    resume_str = json.dumps(resume_summary, indent=2)

    # Extract only required job information
    job_req_summary = {
        "jobTitle": job_data.get("jobRequirements", {}).get("jobTitle", ""),
        "requiredSkills": job_data.get("jobRequirements", {}).get("requiredSkills", [])[:5]
    }
    job_req_str = json.dumps(job_req_summary, indent=2)

    # Extract actual questions from the transcript by analyzing blocks of text
    interviewer_questions = []
    lines = transcript.split('\n')
    
    print(f"Extracting questions from transcript with {len(lines)} lines")
    
    # Process the transcript to extract full interviewer questions with question marks
    current_speaker = None
    current_text = ""
    
    for line in lines:
        if line.startswith('Interviewer'):
            current_speaker = 'Interviewer'
            current_text = line.replace('Interviewer', '').strip()
            if current_text.startswith(':'):
                current_text = current_text[1:].strip()
        elif line.startswith('Candidate'):
            # If we were collecting interviewer text and it ended with a question mark, save it
            if current_speaker == 'Interviewer' and '?' in current_text:
                # Extract the part that ends with a question mark
                question_parts = current_text.split('?')
                if len(question_parts) > 1:
                    # Take everything up to and including the first question mark
                    question = question_parts[0] + '?'
                    if len(question) >= 20:  # Only keep substantive questions
                        interviewer_questions.append(question)
                        print(f"Extracted question: {question[:50]}...")
            
            current_speaker = 'Candidate'
            current_text = ""
        elif current_speaker == 'Interviewer' and line.strip():
            # Continue building the interviewer text
            current_text += " " + line.strip()
    
    # Check for any final question that might be at the end of the transcript
    if current_speaker == 'Interviewer' and '?' in current_text:
        question_parts = current_text.split('?')
        if len(question_parts) > 1:
            question = question_parts[0] + '?'
            if len(question) >= 20:  # Only keep substantive questions
                interviewer_questions.append(question)
                print(f"Extracted question: {question[:50]}...")
    
    # Log extracted questions count
    print(f"Extracted {len(interviewer_questions)} questions from transcript")
    if len(interviewer_questions) == 0:
        print("WARNING: No questions extracted from transcript. Check transcript format.")
        return {"suggestedAnswers": [], "error": "No questions extracted from transcript"}
    
    # Process questions in batches to avoid hitting token limits
    all_suggested_answers = []
    BATCH_SIZE = 3  # Changed from 4 to 3 for better token management
    
    for i in range(0, len(interviewer_questions), BATCH_SIZE):
        batch_questions = interviewer_questions[i:i+BATCH_SIZE]
        batch_num = i//BATCH_SIZE + 1
        total_batches = (len(interviewer_questions) + BATCH_SIZE - 1) // BATCH_SIZE
        
        print(f"Processing batch {batch_num}/{total_batches} with {len(batch_questions)} questions")
        
        system_prompt = f"""
You are an expert interview coach reviewing a mock interview. For each significant interviewer question, provide ONE strong alternative answer the candidate could have given.

Interview Context:
- Candidate: {resume_summary.get("name", "")}, {resume_summary.get("currentPosition", "")}
- Job: {job_req_summary.get("jobTitle", "")}
- Skills Required: {", ".join(job_req_summary.get("requiredSkills", []))}

Interview Questions:
{json.dumps(batch_questions, indent=2)}

For each question, provide ONLY ONE better sample answer. Format as valid JSON with NO control characters:
{{
"suggestedAnswers": [
  {{
    "question": "<Question text>",
    "suggestions": [
      {{"answer": "<Better answer>", "rationale": "<Why this answer is strong>"}}
    ]
  }}
]
}}

Return ONLY valid JSON with NO additional text before or after. IMPORTANT: Do NOT include any control characters in the output.
"""

        messages = [{"role": "user", "content": "Provide one strong alternative answer for each interviewer question."}]

        try:
            # Adjusted max_tokens to be within Claude 3.5 Sonnet's limit
            response_content = call_claude_api(
                messages=messages,
                system_prompt=system_prompt,
                model=CLAUDE_MODEL,
                max_tokens=8000,  # Within Claude 3.5 Sonnet's limit (8192)
                temperature=0.4    
            )

            print(f"Received response for batch {batch_num}, length: {len(response_content)} chars")
            response_text = response_content.strip()

            # Handle markdown code blocks
            if response_text.startswith('```json'):
                response_text = response_text[7:]
            if response_text.endswith('```'):
                response_text = response_text[:-3]
            response_text = response_text.strip()

            # Fallback find {} block if needed
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                json_text = response_text[json_start:json_end].strip()
                print(f"Extracted JSON from response, length: {len(json_text)} chars")
            else:
                print(f"Failed to extract JSON object for batch {batch_num}, response starts with: {response_text[:100]}...")
                continue

            # Aggressive sanitization of the entire JSON string before parsing
            sanitized_json_text = sanitize_string_for_json(json_text)
            
            try:
                # First try to parse the sanitized JSON
                raw_parsed_data = json.loads(sanitized_json_text)
                print(f"Successfully parsed JSON for batch {batch_num}")
            except json.JSONDecodeError as e:
                print(f"JSON decode error for batch {batch_num}: {e}")
                print(f"Problematic JSON (first 200 chars): {sanitized_json_text[:200]}...")
                continue

            # Add answers from this batch to the full list
            answers_count = 0
            if "suggestedAnswers" in raw_parsed_data and isinstance(raw_parsed_data.get("suggestedAnswers"), list):
                for qa_item in raw_parsed_data["suggestedAnswers"]:
                    sanitized_qa = {}
                    sanitized_qa["question"] = sanitize_string_for_json(qa_item.get("question"))

                    sanitized_suggestions = []
                    # Ensure suggestions exist and keep only the first one
                    suggestions = qa_item.get("suggestions", [])
                    if suggestions and isinstance(suggestions, list):
                        first_suggestion = suggestions[0]
                        if isinstance(first_suggestion, dict):
                            sanitized_suggestions.append({
                                "answer": sanitize_string_for_json(first_suggestion.get("answer")),
                                "rationale": sanitize_string_for_json(first_suggestion.get("rationale"))
                            })
                            answers_count += 1

                    sanitized_qa["suggestions"] = sanitized_suggestions
                    all_suggested_answers.append(sanitized_qa)
                print(f"Added {answers_count} answers from batch {batch_num}")
            else:
                print(f"No 'suggestedAnswers' found in response for batch {batch_num}")

        except Exception as e:
            print(f"Error processing batch {batch_num}: {e}")
            traceback.print_exc()
            continue

    # Construct the final data structure with all sanitized content
    final_data = {"suggestedAnswers": all_suggested_answers}

    # Validate JSON serialization works
    try:
        serialized = json.dumps(final_data)  # Test that it can be serialized
        print(f"Suggested answers generated and sanitized successfully: {len(final_data.get('suggestedAnswers', []))} questions, total size: {len(serialized)} bytes")
        if len(serialized) < 100:
            print("WARNING: Serialized JSON is suspiciously small, might be empty or malformed")
        return final_data  # Return the sanitized data
    except Exception as json_err:
        print(f"Final JSON serialization test failed: {json_err}")
        return {"suggestedAnswers": [], "error": "Final JSON validation failed"}


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


def get_user_usage(user_id):
    """Retrieves user profile including usage data from Firestore. Ensures default structure exists."""
    if not db or not user_id:
        return None

    try:
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()

        if user_doc.exists:
            user_data = user_doc.to_dict()
            needs_update = False

            # Ensure 'plan' exists, default to 'free'
            if 'plan' not in user_data:
                user_data['plan'] = 'free'
                # Note: We might not want to update the plan here,
                # just use 'free' for limit calculation.
                # Let's assume plan exists or is handled during user creation.

            current_plan = user_data.get('plan', 'free')

            # Ensure 'usage' map exists
            if 'usage' not in user_data:
                user_data['usage'] = {}
                needs_update = True

            # Ensure 'resumeAnalyses' structure exists
            if 'resumeAnalyses' not in user_data['usage']:
                user_data['usage']['resumeAnalyses'] = {'used': 0, 'limit': get_package_limit(current_plan, 'resumeAnalyses')}
                needs_update = True
            elif 'used' not in user_data['usage']['resumeAnalyses'] or 'limit' not in user_data['usage']['resumeAnalyses']:
                # If partially missing, reset it based on current plan
                user_data['usage']['resumeAnalyses'] = {
                    'used': user_data['usage']['resumeAnalyses'].get('used', 0), # Keep existing used count if possible
                    'limit': get_package_limit(current_plan, 'resumeAnalyses')
                }
                needs_update = True

            # Ensure 'mockInterviews' structure exists
            if 'mockInterviews' not in user_data['usage']:
                 user_data['usage']['mockInterviews'] = {'used': 0, 'limit': get_package_limit(current_plan, 'mockInterviews')}
                 needs_update = True
            elif 'used' not in user_data['usage']['mockInterviews'] or 'limit' not in user_data['usage']['mockInterviews']:
                 user_data['usage']['mockInterviews'] = {
                     'used': user_data['usage']['mockInterviews'].get('used', 0),
                     'limit': get_package_limit(current_plan, 'mockInterviews')
                 }
                 needs_update = True

            # If the structure needed fixing, update the document in Firestore
            if needs_update:
                print(f"[{user_id}] Initializing/Fixing usage structure in Firestore.")
                try:
                    user_ref.update({'usage': user_data['usage']})
                except Exception as update_err:
                     print(f"[{user_id}] WARNING: Failed to update usage structure: {update_err}")
                     # Proceed with potentially stale data, or return None?
                     # For now, proceed. The increment might still fail if update failed.

            return user_data
        else:
            print(f"User {user_id} not found in Firestore")
            # If user doc doesn't exist, should we create it? No, auth should handle that.
            return None

    except Exception as e:
        print(f"Error retrieving user usage for {user_id}: {e}")
        traceback.print_exc()
        return None


def get_package_limit(package_name, feature_type):
    """Returns the limit for a specific feature based on package type."""
    limits = {
        'free': {
            'resumeAnalyses': 1,
            'mockInterviews': 2
        },
        'starter': {
            'resumeAnalyses': 5,
            'mockInterviews': 1
        },
        'standard': {
            'resumeAnalyses': 10,
            'mockInterviews': 3
        },
        'pro': {
            'resumeAnalyses': 20,
            'mockInterviews': 5
        }
    }
    
    # Default to free package if not found
    if not package_name or package_name not in limits:
        print(f"Warning: Unknown package '{package_name}', defaulting to free")
        package_name = 'free'
    
    # Return the limit for the feature, or 0 if feature not found
    return limits[package_name].get(feature_type, 0)


def check_feature_access(user_id, feature_type):
    """Checks if a user has access to a specific feature based on their plan."""
    if not db or not user_id:
        return {'allowed': False, 'error': 'Database or user ID not available'}
    
    try:
        user_data = get_user_usage(user_id)
        
        if not user_data:
            return {'allowed': False, 'error': 'User profile not found'}
        
        if 'usage' not in user_data or feature_type not in user_data['usage']:
            return {'allowed': False, 'error': 'Usage data not found'}
        
        usage = user_data['usage'][feature_type]
        currently_used = usage.get('used', 0)
        limit = usage.get('limit', 0)
        
        # Check if user has used all their available resources
        if currently_used >= limit:
            return {
                'allowed': False,
                'error': f"Usage limit reached for {feature_type}",
                'used': currently_used,
                'limit': limit,
                'plan': user_data.get('plan', 'free')
            }
        
        return {
            'allowed': True,
            'used': currently_used,
            'limit': limit,
            'plan': user_data.get('plan', 'free')
        }
        
    except Exception as e:
        print(f"Error checking feature access for {user_id} ({feature_type}): {e}")
        traceback.print_exc()
        return {'allowed': False, 'error': f'Server error: {str(e)}'}


def increment_usage_counter(user_id, feature_type):
    """Increments usage counter for a specific feature."""
    if not db or not user_id:
        return {'success': False, 'error': 'Database or user ID not available'}
    
    try:
        user_ref = db.collection('users').document(user_id)
        
        # Check if user exists
        user_doc = user_ref.get()
        if not user_doc.exists:
            return {'success': False, 'error': 'User profile not found'}
        
        # Increment counter using atomic operation
        update_field = f'usage.{feature_type}.used'
        
        # Perform the increment
        user_ref.update({
            update_field: firestore.Increment(1)
        })
        
        # Get updated count
        updated_user = user_ref.get().to_dict()
        current_usage = updated_user.get('usage', {}).get(feature_type, {}).get('used', 0)
        usage_limit = updated_user.get('usage', {}).get(feature_type, {}).get('limit', 0)
        
        return {
            'success': True,
            'used': current_usage,
            'limit': usage_limit,
            'remaining': max(0, usage_limit - current_usage)
        }
        
    except Exception as e:
        print(f"Error incrementing usage counter for {user_id} ({feature_type}): {e}")
        traceback.print_exc()
        return {'success': False, 'error': f'Server error: {str(e)}'}

# Helper function to sanitize strings for JSON embedding
def sanitize_string_for_json(text):
    """Thoroughly removes or escapes control characters problematic for JSON."""
    if not isinstance(text, str):
        return text  # Return non-strings as is
    
    # More aggressive control character handling - catches all JSON-breaking characters
    # Remove all control characters (0-31) plus DEL (127)
    cleaned_text = ''
    for char in text:
        # Skip all control characters completely
        if ord(char) >= 32 and ord(char) != 127:
            cleaned_text += char
        elif char in ['\n', '\t', '\r']:
            # Replace common whitespace with spaces instead of removing
            cleaned_text += ' '
    
    # Additional safety for quote handling
    cleaned_text = cleaned_text.replace('\\', '\\\\')  # Escape backslashes first
    
    # Double-check for any remaining invalid characters
    checked_text = ''
    for char in cleaned_text:
        if 31 < ord(char) < 127 or ord(char) > 127:
            checked_text += char
        else:
            checked_text += ' '  # Replace any remaining control chars with space
    
    return checked_text.strip()  # Remove leading/trailing whitespace

def call_haiku_for_enhancement(section_type, original_content):
    """Calls Claude Haiku to enhance a specific resume section."""
    if not CLAUDE_API_KEY:
        raise ValueError("Claude API Key is not configured.")

    # --- Define specific prompts based on section type ---
    if section_type == 'objective':
        system_prompt = "You are an expert resume writer. Rewrite this professional summary/objective to be concise, impactful, and ATS-friendly. Make it exactly 2-3 sentences long with strong action words and quantifiable achievements where possible. Do not include any headers, labels, or introductory text. Return ONLY the enhanced objective text."
        user_content = f"Original Objective/Summary:\n{original_content}"
        max_tokens = 200
        temperature = 0.6
    elif section_type == 'experience':
        system_prompt = "You are an expert resume writer. Rewrite the following work experience description using strong action verbs and quantified achievements. Format as clean bullet points using '*' or '-'. Keep each bullet concise (1-2 lines max). Do not include headers or labels. Return ONLY the bullet points."
        user_content = f"Original Experience Description:\n{original_content}"
        max_tokens = 300
        temperature = 0.5
    elif section_type == 'internship':
        system_prompt = "You are an expert resume writer. Rewrite the following internship description using strong action verbs and highlighting key contributions. Format as clean bullet points using '*' or '-'. Keep each bullet concise and ATS-friendly. Do not include headers or labels. Return ONLY the bullet points."
        user_content = f"Original Internship Description:\n{original_content}"
        max_tokens = 250
        temperature = 0.5
    elif section_type == 'project':
        system_prompt = "You are an expert resume writer. Rewrite the following project description to be concise and technical. Format as clean bullet points using '*' or '-'. Focus on technologies used and key outcomes. Keep each bullet 1-2 lines maximum. Do not include headers or labels. Return ONLY the bullet points."
        user_content = f"Original Project Description:\n{original_content}"
        max_tokens = 250
        temperature = 0.5
    elif section_type == 'publication':
        system_prompt = "You are an expert academic resume writer. Rewrite the following publication description to be professional and concise. Focus on research contribution and methodology. Keep it brief and academic. Do not include headers or labels. Return ONLY the enhanced description."
        user_content = f"Original Publication Description:\n{original_content}"
        max_tokens = 200
        temperature = 0.4
    elif section_type == 'accomplishment':
        system_prompt = "You are an expert resume writer. Rewrite the following accomplishment to be impactful and quantified. Use strong action verbs and include specific results where possible. Keep it concise (1-2 sentences). Do not include headers or labels. Return ONLY the enhanced accomplishment text."
        user_content = f"Original Accomplishment:\n{original_content}"
        max_tokens = 150
        temperature = 0.5
    elif section_type == 'award':
        system_prompt = "You are an expert resume writer. Rewrite the following award description to be professional and concise. Explain the significance briefly. Keep it short (1-2 sentences maximum). Do not include headers or labels. Return ONLY the enhanced description."
        user_content = f"Original Award Description:\n{original_content}"
        max_tokens = 100
        temperature = 0.5
    elif section_type == 'extracurricular':
        system_prompt = "You are an expert resume writer. Rewrite the following extracurricular activity description to highlight transferable skills and leadership. Format as clean bullet points using '*' or '-'. Keep each bullet concise and professional. Do not include headers, labels, or introductory text. Return ONLY the bullet points."
        user_content = f"Original Extracurricular Description:\n{original_content}"
        max_tokens = 200
        temperature = 0.5
    elif section_type == 'customSection':
        # For custom sections, we need to extract the section title for context
        lines = original_content.split('\n')
        section_title = lines[0] if lines else "Custom Section"
        content = '\n'.join(lines[1:]) if len(lines) > 1 else original_content
        
        system_prompt = f"You are an expert resume writer. Based on the section title '{section_title}', rewrite the following content to be professional and ATS-friendly. Use bullet points with '*' or '-' if multiple items, otherwise write as concise paragraph. Keep it brief and relevant to career goals. Do not include headers or labels. Return ONLY the enhanced content."
        user_content = f"Section Title: {section_title}\nOriginal Content:\n{content}"
        max_tokens = 250
        temperature = 0.6
    elif section_type == 'skills':
        system_prompt = """You are an expert resume writer. Analyze the following skills and intelligently organize them into logical categories based on their type and domain. Create appropriate category names that fit the skills provided (e.g., for software engineers: Programming Languages, Web Technologies, etc.; for mechanical engineers: CAD Software, Manufacturing Tools, etc.; for marketing: Digital Marketing Tools, Analytics Platforms, etc.).

Format the output exactly like this example:
**Category Name 1:** skill1, skill2, skill3
**Category Name 2:** skill1, skill2, skill3
**Category Name 3:** skill1, skill2, skill3

Rules:
- Use bold formatting (**) for category titles
- Use comma-separated lists for skills within each category
- Create 3-7 relevant categories based on the skills provided
- Don't force predefined categories - create them based on what skills are actually provided
- Group related skills together logically
- Include soft skills as a separate category if any are mentioned
- Do not include any other text, headers, or explanations
- Return ONLY the categorized skills in the format shown above"""
        user_content = f"Skills to organize and categorize:\n{original_content}"
        max_tokens = 300
        temperature = 0.3
    else:
        # Fallback for unknown types
        system_prompt = "You are a resume writing expert. Rewrite the following text to be more professional and concise. Do not include headers or labels. Return ONLY the improved text."
        user_content = f"Original Text:\n{original_content}"
        max_tokens = 200
        temperature = 0.7

    messages = [{"role": "user", "content": user_content}]

    print(f"--- Calling Claude Haiku for '{section_type}' enhancement ---")
    # Use the call_claude_api helper, specifying the Haiku model
    enhanced_content = call_claude_api(
        messages=messages,
        system_prompt=system_prompt,
        model=CLAUDE_HAIKU_MODEL, # Specify Haiku model
        temperature=temperature,
        max_tokens=max_tokens
    )
    
    # Clean up any potential unwanted prefixes that might slip through
    enhanced_content = enhanced_content.strip()
    
    # Remove common unwanted prefixes if they appear
    unwanted_prefixes = [
        "Rewritten", "Enhanced", "Improved", "Updated", "Here is", "Here's",
        "Professional", "Summary:", "Description:", "Objective:", "Skills:",
        "Experience:", "Project:", "Award:", "Accomplishment:"
    ]
    
    for prefix in unwanted_prefixes:
        if enhanced_content.startswith(prefix):
            # Find the first colon or newline after the prefix
            colon_pos = enhanced_content.find(':')
            newline_pos = enhanced_content.find('\n')
            
            if colon_pos != -1:
                enhanced_content = enhanced_content[colon_pos + 1:].strip()
            elif newline_pos != -1:
                enhanced_content = enhanced_content[newline_pos + 1:].strip()
            break
    
    return enhanced_content

def get_package_limit(package_name, feature_type):
    """Returns the limit for a specific feature based on package type."""
    limits = {
        'free': {
            'resumeAnalyses': 1,
            'mockInterviews': 2,
            'pdfDownloads': 5,
            'aiEnhance': 5
        },
        'starter': {
            'resumeAnalyses': 5,
            'mockInterviews': 1,
            'pdfDownloads': 20,
            'aiEnhance': 20
        },
        'standard': {
            'resumeAnalyses': 10,
            'mockInterviews': 3,
            'pdfDownloads': 50,
            'aiEnhance': 50
        },
        'pro': {
            'resumeAnalyses': 20,
            'mockInterviews': 5,
            'pdfDownloads': 100,
            'aiEnhance': 100
        }
    }
    
    # Default to free package if not found
    if not package_name or package_name not in limits:
        print(f"Warning: Unknown package '{package_name}', defaulting to free")
        package_name = 'free'
    
    # Return the limit for the feature, or 0 if feature not found
    return limits[package_name].get(feature_type, 0)

# Example if using Redis for caching
def get_cached_suggested_answers(interview_id):
    cache_key = f"suggested_answers:{interview_id}"
    cached_data = redis_client.get(cache_key)
    if cached_data:
        return json.loads(cached_data)
    return None
    
def cache_suggested_answers(interview_id, suggestions, ttl=86400):  # Cache for 24 hours
    cache_key = f"suggested_answers:{interview_id}"
    redis_client.setex(cache_key, ttl, json.dumps(suggestions))

def process_captured_payment(order_data, payment_id):
    """Processes a captured payment based on order type."""
    try:
        user_id = order_data.get('userId')
        order_type = order_data.get('order_type')
        
        if not user_id or not order_type:
            print(f"ERROR: Missing user_id or order_type in order data")
            return False
            
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            print(f"ERROR: User {user_id} not found")
            return False
            
        # Handle plan upgrade
        if order_type == 'plan':
            plan_name = order_data.get('plan_name')
            if not plan_name:
                print(f"ERROR: Plan name not found for order")
                return False
                
            # Calculate new limits based on the plan
            resume_limit = get_package_limit(plan_name, 'resumeAnalyses')
            interview_limit = get_package_limit(plan_name, 'mockInterviews')
            pdf_limit = get_package_limit(plan_name, 'pdfDownloads')
            ai_limit = get_package_limit(plan_name, 'aiEnhance')
            
            # Update user profile with new plan and RESET usage counters to 0
            update_data = {
                'plan': plan_name,
                'planPurchasedAt': datetime.now().isoformat(),
                'planExpiresAt': None,  # No expiration for now
                'usage.resumeAnalyses.limit': resume_limit,
                'usage.resumeAnalyses.used': 0,  # Reset to 0
                'usage.mockInterviews.limit': interview_limit,
                'usage.mockInterviews.used': 0,  # Reset to 0
                'usage.pdfDownloads.limit': pdf_limit,
                'usage.pdfDownloads.used': 0,  # Reset to 0
                'usage.aiEnhance.limit': ai_limit,
                'usage.aiEnhance.used': 0,  # Reset to 0
                'last_updated': firestore.SERVER_TIMESTAMP
            }
            
            # Record the payment in payments collection
            payment_data = {
                'userId': user_id,
                'orderId': order_data.get('orderId'),
                'paymentId': payment_id,
                'amount': order_data.get('amount', 0) / 100,  # Convert from paise to rupees
                'currency': order_data.get('currency', 'INR'),
                'type': 'plan_upgrade',
                'planName': plan_name,
                'status': 'completed',
                'webhook_processed': True,
                'timestamp': datetime.now().isoformat()
            }
            
            # Create a transaction to update multiple documents atomically
            transaction = db.transaction()
            
            @firestore.transactional
            def update_in_transaction(transaction, user_ref, payment_data):
                # Update user plan
                transaction.update(user_ref, update_data)
                
                # Add payment record
                payment_ref = db.collection('payments').document()
                transaction.set(payment_ref, payment_data)
                
                return payment_ref.id
                
            payment_id = update_in_transaction(transaction, user_ref, payment_data)
            print(f"Plan upgrade completed via webhook for user {user_id}, payment record: {payment_id}")
            return True
            
        # Handle addon purchase
        elif order_type == 'addon':
            feature_type = order_data.get('feature_type')
            quantity = int(order_data.get('quantity', 1))
            effective_quantity = int(order_data.get('effective_quantity', quantity))
            
            if not feature_type:
                print(f"ERROR: Feature type not found for addon purchase")
                return False
                
            # Get current usage
            user_data = get_user_usage(user_id)
            if not user_data:
                print(f"ERROR: Failed to get user data for {user_id}")
                return False
                
            # Get current limit and used values
            usage = user_data.get('usage', {}).get(feature_type, {})
            current_limit = usage.get('limit', 0)
            current_used = usage.get('used', 0)
            
            # Calculate new limit
            new_limit = current_limit + effective_quantity
            
            # Update user's limit
            update_data = {
                f'usage.{feature_type}.limit': new_limit,
                'last_updated': firestore.SERVER_TIMESTAMP
            }
            
            # Record addon purchase
            addon_purchase = {
                'userId': user_id,
                'orderId': order_data.get('orderId'),
                'paymentId': payment_id,
                'feature': feature_type,
                'quantity': quantity,
                'effectiveQuantity': effective_quantity,
                'unitPrice': order_data.get('amount', 0) / quantity / 100,  # Convert from paise to rupees
                'totalPrice': order_data.get('amount', 0) / 100,  # Convert from paise to rupees
                'currency': order_data.get('currency', 'INR'),
                'purchaseDate': datetime.now().isoformat(),
                'previousLimit': current_limit,
                'newLimit': new_limit,
                'usedAtPurchase': current_used,
                'webhook_processed': True
            }
            
            # Create a transaction
            transaction = db.transaction()
            
            @firestore.transactional
            def update_addon_in_transaction(transaction, user_ref, addon_purchase):
                # Update user limits
                transaction.update(user_ref, update_data)
                
                # Add purchase record
                purchase_ref = db.collection('addonPurchases').document()
                transaction.set(purchase_ref, addon_purchase)
                
                # Add payment record
                payment_data = {
                    'userId': user_id,
                    'orderId': order_data.get('orderId'),
                    'paymentId': payment_id,
                    'amount': addon_purchase['totalPrice'],
                    'currency': addon_purchase['currency'],
                    'type': 'addon_purchase',
                    'featureType': feature_type,
                    'quantity': quantity,
                    'effectiveQuantity': effective_quantity,
                    'status': 'completed',
                    'webhook_processed': True,
                    'timestamp': datetime.now().isoformat()
                }
                
                payment_ref = db.collection('payments').document()
                transaction.set(payment_ref, payment_data)
                
                return purchase_ref.id
            
            purchase_id = update_addon_in_transaction(transaction, user_ref, addon_purchase)
            print(f"Addon purchase completed via webhook for user {user_id}, purchase record: {purchase_id}")
            return True
            
        else:
            print(f"ERROR: Unknown order type: {order_type}")
            return False
            
    except Exception as e:
        print(f"Error processing captured payment: {e}")
        traceback.print_exc()
        return False


# === Flask Routes ===

@app.route('/test', methods=['GET'])
def test_route():
    """Simple health check endpoint."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db_status = "OK" if db else "Unavailable"
    bucket_status = "OK" if bucket else "Unavailable"
    razorpay_status = "OK" if razorpay_client else "Unavailable"
    
    config_status = {
        "firebase_admin_sdk": "OK" if firebase_admin._DEFAULT_APP_NAME in firebase_admin._apps else "Not Initialized",
        "firestore_client": db_status,
        "storage_client": bucket_status,
        "razorpay_client": razorpay_status,
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

# Replace this entire route function in backend.py
@app.route('/analyze-resume', methods=['POST'])
def analyze_resume():
    """
    Analyzes resume against JD, enforces usage limits,
    increments usage counter, creates session in Firestore, starts background analysis,
    updates user profile with lastActiveSessionId, AND returns updated usage info.
    """
    session_id = None
    temp_session_dir = None
    temp_resume_path = None
    user_id = None

    try:
        start_time = time.time()

        # --- Validate Request ---
        if 'resumeFile' not in request.files:
            return jsonify({'error': 'No resume file'}), 400

        resume_file = request.files['resumeFile']
        job_description = request.form.get('jobDescription')
        user_id = request.form.get('userId')

        if not job_description:
            return jsonify({'error': 'Job description required'}), 400

        if not resume_file or not resume_file.filename:
            return jsonify({'error': 'Invalid resume file'}), 400

        if not user_id:
            return jsonify({'error': 'User ID required for session tracking'}), 400

        resume_filename = secure_filename(resume_file.filename)
        if not (resume_file.content_type == 'application/pdf' or resume_filename.lower().endswith('.pdf')):
            return jsonify({'error': 'Only PDF resumes supported'}), 400

        if not db:
            return jsonify({'error': 'Database unavailable'}), 503
        # --- End Validation ---

        # --- Check usage limits ---
        access_check = check_feature_access(user_id, 'resumeAnalyses')
        if not access_check.get('allowed', False):
            # Return specific error indicating limit reached
            return jsonify({
                'error': access_check.get('error', 'Usage limit reached'),
                'limitReached': True, # Flag for frontend
                'used': access_check.get('used', 0),
                'limit': access_check.get('limit', 0),
                'plan': access_check.get('plan', 'free')
            }), 403  # Forbidden due to limits
        # --- End usage limit check ---

        session_id = str(uuid.uuid4())
        print(f"[{session_id}] Received /analyze-resume request for file: {resume_filename} from user: {user_id}")

        # === Temporary Local File Handling ===
        try:
            temp_session_dir = os.path.join(BASE_TEMP_DIR, session_id)
            os.makedirs(temp_session_dir, exist_ok=True)
            temp_resume_path = os.path.join(temp_session_dir, resume_filename)
            resume_file.save(temp_resume_path)
            print(f"[{session_id}] Resume temporarily saved locally to: {temp_resume_path}")
        except Exception as file_err:
            print(f"[{session_id}] ERROR: Failed to save temporary resume file: {file_err}")
            traceback.print_exc()
            return jsonify({'error': f'Server file system error: {str(file_err)}'}), 500
        # === End File Handling ===

        # --- Increment Usage Counter (BEFORE creating session, in case of errors) ---
        # This function now returns {'success': True/False, 'used': N, 'limit': M, 'remaining': X}
        increment_result = increment_usage_counter(user_id, 'resumeAnalyses')
        if not increment_result.get('success', False):
            error_msg = increment_result.get('error', 'Failed to update usage counter')
            print(f"[{session_id}] ERROR: {error_msg}")
            # Clean up temp file if usage increment fails
            if temp_session_dir and os.path.exists(temp_session_dir):
                try:
                    shutil.rmtree(temp_session_dir)
                except Exception as cleanup_err:
                    print(f"[{session_id}] Error during cleanup after usage error: {cleanup_err}")
            return jsonify({'error': error_msg}), 500
        # --- End Usage Increment ---

        # --- Initialize session doc in Firestore ---
        session_ref = db.collection('sessions').document(session_id)
        initial_session_data = {
            'status': 'processing',
            'progress': 5,
            'userId': user_id,
            'resume_filename_temp': resume_filename,
            'job_description': job_description,
            'start_time': datetime.now().isoformat(),
            'results': {},
            'errors': [],
            'last_updated': firestore.SERVER_TIMESTAMP,
             # Add usage tracking to session for reference (using data from increment_result)
            'usage_info': {
                'feature': 'resumeAnalyses',
                'used': increment_result.get('used', 0),
                'limit': increment_result.get('limit', 0)
            }
        }
        session_ref.set(initial_session_data)
        print(f"[{session_id}] Initial session created in Firestore for user {user_id}.")
        # --- End Firestore Init ---

        # --- Update User Profile with lastActiveSessionId ---
        try:
            user_ref = db.collection('users').document(user_id)
            user_ref.update({
                'lastActiveSessionId': session_id,
                'lastSessionUpdate': firestore.SERVER_TIMESTAMP
            })
            print(f"[{session_id}] Updated user {user_id} profile with lastActiveSessionId.")
        except Exception as profile_update_err:
            print(f"[{session_id}] WARNING: Failed to update user {user_id} profile with last session ID: {profile_update_err}")
        # --- End User Profile Update ---

        # --- Define background task ---
        def process_resume_background(current_session_id, resume_local_path, jd, associated_user_id):
            session_status = 'failed'; error_list = []
            try:
                # (Existing background processing logic...)
                print(f"[{current_session_id}] Background task started for local file: {resume_local_path}, User: {associated_user_id}")
                update_session_data(current_session_id, {'progress': 10, 'status_detail': 'Extracting text'})
                resume_text = extract_text_from_pdf(resume_local_path)
                if not resume_text: raise ValueError("Failed to extract text from PDF.")
                update_session_data(current_session_id, {'progress': 30, 'status_detail': 'Parsing resume'})
                parsed_resume = parse_resume_with_claude(resume_text)
                if not parsed_resume or not parsed_resume.get("name"): raise ValueError("Failed to parse resume.")
                update_session_data(current_session_id, {'progress': 50, 'status_detail': 'Matching resume/JD'})
                # CHANGED LINE - Using OpenAI instead of Gemini
                match_results = match_resume_jd_with_openai(parsed_resume, jd)
                if match_results.get("error"): raise ValueError(f"JD matching failed: {match_results['error']}")
                match_results['parsedResume'] = parsed_resume # Add parsed data here for context
                update_session_data(current_session_id, {'progress': 80, 'status_detail': 'Generating prep plan'})
                prep_plan = generate_interview_prep_plan(match_results)
                if not prep_plan: raise ValueError("Failed to generate prep plan.")
                final_results = { 'parsed_resume': parsed_resume, 'match_results': match_results, 'prep_plan': prep_plan }
                update_session_data(current_session_id, { 'results': final_results, 'status': 'completed', 'progress': 100, 'status_detail': 'Analysis complete', 'end_time': datetime.now().isoformat() })
                session_status = 'completed'
            except Exception as e:
                # (Existing error handling...)
                error_msg = f"Error in background task for {current_session_id}: {e}"; print(error_msg); traceback.print_exc(); error_list.append(str(e))
                update_session_data(current_session_id, { 'status': 'failed', 'errors': firestore.ArrayUnion([str(e)]), 'status_detail': f'Error: {str(e)[:100]}...', 'end_time': datetime.now().isoformat() })
            finally:
                # (Existing cleanup logic...)
                dir_to_remove = os.path.dirname(resume_local_path)
                try:
                    if os.path.exists(dir_to_remove): print(f"[{current_session_id}] Cleaning up temp dir: {dir_to_remove}"); shutil.rmtree(dir_to_remove)
                except Exception as cleanup_error: print(f"[{current_session_id}] WARNING: Failed to cleanup temp dir {dir_to_remove}: {cleanup_error}")
                print(f"[{current_session_id}] Background processing finished with status: {session_status}")
        # --- End background task definition ---

        # Start background thread
        processing_thread = threading.Thread(target=process_resume_background, args=(session_id, temp_resume_path, job_description, user_id))
        processing_thread.daemon = True
        processing_thread.start()

        print(f"[{session_id}] /analyze-resume request completed in {time.time() - start_time:.2f}s (background running).")

        # Return the latest usage info obtained from increment_result
        return jsonify({
            'sessionId': session_id,
            'status': 'processing',
            'message': 'Resume analysis started',
            'usageInfo': { # Include updated usage info
                'feature': 'resumeAnalyses',
                'used': increment_result.get('used', 0),
                'limit': increment_result.get('limit', 0),
                'remaining': increment_result.get('remaining', 0)
            }
        }), 202 # Accepted

    except Exception as e:
        print(f"Error in /analyze-resume route: {e}")
        traceback.print_exc()
        if session_id and db:
            update_session_data(session_id, {'status': 'failed', 'errors': firestore.ArrayUnion([f'Route level error: {str(e)}'])})
        if temp_resume_path and os.path.exists(os.path.dirname(temp_resume_path)):
            try:
                shutil.rmtree(os.path.dirname(temp_resume_path))
            except Exception as cleanup_err:
                print(f"Error cleaning up temp dir during route exception: {cleanup_err}")
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
        # CHANGE THIS LINE
        timeline_result = generate_dynamic_timeline_with_openai(session_data, days)
        # END OF CHANGE
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


# Replace this entire route function in backend.py
@app.route('/start-mock-interview', methods=['POST'])
def start_mock_interview():
    """
    Initializes a new mock interview session in Firestore, with usage limit checks,
    increments counter, and returns updated usage info.
    """
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON payload'}), 400
        session_id = data.get('sessionId')
        interview_type = data.get('interviewType', 'general')
        if not session_id: return jsonify({'error': 'Session ID required'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503

        # --- Get session data to retrieve user ID ---
        session_data = get_session_data(session_id)
        if session_data is None: return jsonify({'error': 'Session not found or expired'}), 404
        if session_data.get('status') != 'completed': return jsonify({'error': 'Analysis not completed'}), 400

        # Get user ID from session
        user_id = session_data.get('userId')
        if not user_id: return jsonify({'error': 'User ID not found in session'}), 400

        # --- Check usage limits for mock interviews ---
        access_check = check_feature_access(user_id, 'mockInterviews')
        if not access_check.get('allowed', False):
            # Return specific error indicating limit reached
            return jsonify({
                'error': access_check.get('error', 'Usage limit reached for mock interviews'),
                'limitReached': True, # Flag for frontend
                'used': access_check.get('used', 0),
                'limit': access_check.get('limit', 0),
                'plan': access_check.get('plan', 'free')
            }), 403  # Forbidden due to limits

        # --- Fetch data required for the interview ---
        resume_data = session_data.get('results', {}).get('parsed_resume')
        job_data = session_data.get('results', {}).get('match_results')
        if not resume_data or not job_data: return jsonify({'error': 'Required analysis data missing'}), 500

        # --- Increment Usage Counter BEFORE creating interview ---
        increment_result = increment_usage_counter(user_id, 'mockInterviews')
        if not increment_result.get('success', False):
            error_msg = increment_result.get('error', 'Failed to update usage counter')
            print(f"[{session_id}] ERROR: {error_msg}")
            return jsonify({'error': error_msg}), 500

        # --- Create interview ID and generate system prompt ---
        interview_id = str(uuid.uuid4())
        system_prompt = create_mock_interviewer_prompt(resume_data, job_data, interview_type)

        # --- Generate initial greeting ---
        initial_prompt = f"Start the '{interview_type}' interview with {resume_data.get('name', 'the candidate')}. Give a brief professional greeting and ask your first question."
        try:
            # Get current time for context
            current_time_str = datetime.now().strftime("%I:%M %p")  # e.g., "01:15 PM"
            
            greeting = call_claude_api(
                messages=[{"role": "user", "content": initial_prompt}],
                system_prompt=system_prompt, 
                model=CLAUDE_MODEL,
                temperature=0.3,  # Lower temperature for more consistency
                current_time_str=current_time_str  # Pass current time
            )
        except Exception as e:
            print(f"[{session_id}] Error generating greeting for interview {interview_id}: {e}")
            greeting = f"Hello {resume_data.get('name', 'there')}. Welcome to your {interview_type} mock interview. Let's begin. Can you start by telling me a bit about yourself and your background?"

        # --- Create interview document in Firestore ---
        interview_doc_ref = db.collection('interviews').document(interview_id)
        interview_data_to_save = {
            'sessionId': session_id,
            'userId': user_id,  # Store user ID directly in interview doc
            'interviewType': interview_type,
            'system_prompt_summary': system_prompt[:1000] + "...",
            'conversation': [{'role': 'assistant', 'content': greeting, 'timestamp': datetime.now().isoformat()}],
            'status': 'active',
            'start_time': datetime.now().isoformat(),
            'last_updated': firestore.SERVER_TIMESTAMP,
            'resume_data_snapshot': resume_data,
            'job_data_snapshot': job_data,
            'analysis_status': 'not_started',
            'analysis': None,
            # Add usage tracking info to interview (using data from increment_result)
            'usage_info': {
                'feature': 'mockInterviews',
                'used': increment_result.get('used', 0),
                'limit': increment_result.get('limit', 0)
            }
        }
        interview_doc_ref.set(interview_data_to_save)
        print(f"[{session_id}] Started interview {interview_id} of type {interview_type} for user {user_id}.")

        # Return the latest usage info obtained from increment_result
        return jsonify({
            'interviewId': interview_id,
            'sessionId': session_id,
            'interviewType': interview_type,
            'greeting': greeting,
            'usageInfo': { # Include updated usage info
                'feature': 'mockInterviews',
                'used': increment_result.get('used', 0),
                'limit': increment_result.get('limit', 0),
                'remaining': increment_result.get('remaining', 0)
            }
        })

    except Exception as e:
        print(f"Error in /start-mock-interview: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error starting interview: {str(e)}'}), 500


@app.route('/interview-response', methods=['POST'])
def interview_response():
    """Processes user response, gets AI response, updates Firestore conversation."""
    interview_id = None # Define interview_id at the start of the function scope
    try:
        data = request.get_json()
        interview_id = data.get('interviewId') # Assign value here
        user_response = data.get('userResponse')
        if not interview_id: return jsonify({'error': 'Interview ID required'}), 400
        # Assuming `db` is the initialized Firestore client global variable
        if not db: return jsonify({'error': 'Database unavailable'}), 503

        interview_data = get_interview_data(interview_id)
        if interview_data is None: return jsonify({'error': 'Interview session not found'}), 404
        if interview_data.get('status') != 'active': return jsonify({'error': 'Interview is not active'}), 400

        # Add user response to conversation in Firestore
        if not add_conversation_message(interview_id, 'user', user_response):
             return jsonify({'error': 'Failed to save user response'}), 500

        # Refresh interview_data to get latest conversation for Claude context
        updated_interview_data = get_interview_data(interview_id)
        if not updated_interview_data: # Check if fetch failed
             return jsonify({'error': 'Failed to retrieve updated interview data'}), 500

        current_conversation = updated_interview_data.get('conversation', [])
        # Retrieve the original system prompt stored during interview start
        # Regenerate the prompt using stored snapshot data
        resume_data = updated_interview_data.get('resume_data_snapshot', {})
        job_data = updated_interview_data.get('job_data_snapshot', {})
        interview_type = updated_interview_data.get('interviewType', 'general') # Get the type used for this interview
        system_prompt = create_mock_interviewer_prompt(resume_data, job_data, interview_type) # Regenerate prompt

        # Get current time for context
        current_time_str = datetime.now().strftime("%I:%M %p")

        # Generate interviewer's next response with LOWER temperature and time context
        interviewer_response = "[IRIS encountered an issue generating a response. Please try again.]" # Default fallback
        try:
            # Reformat conversation for Claude API if needed (role 'user'/'assistant')
            # Ensure roles are 'user' and 'assistant' as expected by Claude API
            api_conversation = []
            for msg in current_conversation:
                role = msg.get('role')
                # Map Firestore roles ('user', 'assistant') to Claude roles ('user', 'assistant')
                # Assuming Firestore roles are already 'user' and 'assistant' based on add_conversation_message
                if role in ['user', 'assistant']:
                     api_conversation.append({'role': role, 'content': msg.get('content', '')})
                # Skip system messages or other roles if they exist in Firestore history

            interviewer_response = call_claude_api(
                messages=api_conversation,
                system_prompt=system_prompt,
                model=CLAUDE_MODEL,
                temperature=0.3, # <-- SET TEMPERATURE
                current_time_str=current_time_str # <-- PASS CURRENT TIME
            )
            # Add AI response to conversation in Firestore
            if not add_conversation_message(interview_id, 'assistant', interviewer_response):
                 # Log error but maybe still return response to user?
                 print(f"[{interview_id}] Failed to save assistant response to Firestore, but proceeding.")

        except Exception as e:
            print(f"[{interview_id}] Error generating interviewer response: {e}")
            # Fallback response is already set above
            # Attempt to save error message as assistant response
            add_conversation_message(interview_id, 'assistant', interviewer_response) # Save the fallback message

        return jsonify({'interviewerResponse': interviewer_response})
    except Exception as e:
        # Ensure interview_id has a value before using in the error message
        id_for_log = interview_id if interview_id else "Unknown Interview"
        print(f"Error in /interview-response route for {id_for_log}: {e}")
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
        job_data = updated_interview_data.get('job_data_snapshot', {}) # Pass full match results
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
                
                # Generate suggested answers in the same process
                print(f"[{current_interview_id}] Generating suggested answers...")
                suggested_answers = generate_suggested_answers(transcript_text, resume_info, job_reqs)
                
                # Store both analysis and suggested answers in interview document
                update_interview_data(current_interview_id, {
                    'analysis': analysis_result, 
                    'suggested_answers': suggested_answers,
                    'analysis_status': 'completed'
                })
                
                analysis_status = 'completed'
                print(f"[{current_interview_id}] Analysis and suggested answers completed and saved.")

                # --- Track Progress ---
                if linked_session_id and analysis_result:
                    print(f"[{current_interview_id}] Attempting to track progress for session {linked_session_id}.")
                    # We'll store progress directly in the 'sessions' document for simplicity
                    session_data = get_session_data(linked_session_id)
                    if session_data:
                        past_interviews = session_data.get('progress_history', {}).get('interviews', [])
                        metrics = {
                            "date": datetime.now().isoformat(),
                            "interviewId": current_interview_id,
                            "interviewType": "general",  # You might want to get this from interview_data
                            "overallScore": analysis_result.get("overallScore", 0),
                            "technicalScore": analysis_result.get("technicalAssessment", {}).get("score", 0),
                            "communicationScore": analysis_result.get("communicationAssessment", {}).get("score", 0),
                            "behavioralScore": analysis_result.get("behavioralAssessment", {}).get("score", 0)
                        }
                        past_interviews.append(metrics)
                        past_interviews.sort(key=lambda x: x["date"])  # Sort oldest first

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


# --- Make sure the route uses the updated function ---
@app.route('/get-suggested-answers/<interview_id>', methods=['GET'])
def get_suggested_answers_route(interview_id):
    """Retrieves suggested answers from Firestore or generates them if not available."""
    try:
        if not db: return jsonify({'error': 'Database unavailable'}), 503
        
        # Add force regenerate parameter
        force_regenerate = request.args.get('force', 'false').lower() == 'true'
        
        interview_data = get_interview_data(interview_id)
        if interview_data is None: return jsonify({'error': 'Interview session not found'}), 404

        # Check if suggested answers are already stored and valid (only if not forcing regeneration)
        if not force_regenerate and 'suggested_answers' in interview_data and interview_data['suggested_answers']:
            # Verify it's not an empty structure
            suggested_answers = interview_data['suggested_answers']
            answers_count = len(suggested_answers.get('suggestedAnswers', []))
            
            if answers_count > 0:
                print(f"[{interview_id}] Retrieving cached suggested answers from Firestore ({answers_count} answers)")
                return jsonify(suggested_answers)
            else:
                print(f"[{interview_id}] Cached suggested answers exist but contain 0 answers. Will regenerate.")
        else:
            if force_regenerate:
                print(f"[{interview_id}] Force regeneration requested")
            else:
                print(f"[{interview_id}] Suggested answers not found, generating on-demand...")
                
        # Generate new suggestions
        conversation = interview_data.get('conversation', [])
        resume_data = interview_data.get('resume_data_snapshot')
        job_data = interview_data.get('job_data_snapshot')
        if not conversation or not resume_data or not job_data:
            return jsonify({'error': 'Missing required data for generating suggestions'}), 500

        transcript_text = "\n".join([
            f"{'Interviewer' if msg.get('role') == 'assistant' else 'Candidate'}: {msg.get('content', '')}"
            for msg in conversation
        ])
        
        print(f"[{interview_id}] Generating suggestions for transcript of {len(transcript_text)} characters")
        
        # Generate suggestions
        suggestions = generate_suggested_answers(transcript_text, resume_data, job_data)
        
        # Check if suggestions were successfully generated
        answers_count = len(suggestions.get('suggestedAnswers', []))
        if answers_count > 0:
            print(f"[{interview_id}] Successfully generated {answers_count} suggested answers")
            
            # Store for future requests
            try:
                update_interview_data(interview_id, {'suggested_answers': suggestions})
                print(f"[{interview_id}] Cached newly generated suggested answers in Firestore")
            except Exception as cache_err:
                print(f"[{interview_id}] Warning: Could not cache suggested answers: {cache_err}")
                
            # Return the generated suggestions
            return jsonify(suggestions)
        else:
            error_msg = suggestions.get('error', 'No suggestions could be generated')
            print(f"[{interview_id}] Failed to generate suggestions: {error_msg}")
            return jsonify({
                'error': error_msg,
                'suggestedAnswers': []
            }), 500
            
    except Exception as e:
        print(f"Error in /get-suggested-answers route for {interview_id}: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error generating suggestions: {str(e)}', 'suggestedAnswers': []}), 500


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

@app.route('/check-feature-access', methods=['POST'])
def check_feature_access_route():
    """API endpoint to check if user can access a specific feature based on plan."""
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON payload'}), 400
        
        user_id = data.get('userId')
        feature_type = data.get('feature')
        
        if not user_id: return jsonify({'error': 'User ID required'}), 400
        if not feature_type: return jsonify({'error': 'Feature type required'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503
        
        if feature_type not in ['resumeAnalyses', 'mockInterviews']:
            return jsonify({'error': f'Invalid feature type: {feature_type}'}), 400
            
        # Check access
        access_result = check_feature_access(user_id, feature_type)
        
        # Return the result directly
        return jsonify(access_result)
        
    except Exception as e:
        print(f"Error in /check-feature-access: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}', 'allowed': False}), 500


@app.route('/update-user-plan', methods=['POST'])
def update_user_plan():
    """Updates a user's plan in Firestore."""
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON payload'}), 400
        
        user_id = data.get('userId')
        plan_name = data.get('plan')
        
        if not user_id: return jsonify({'error': 'User ID required'}), 400
        if not plan_name: return jsonify({'error': 'Plan name required'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503
        
        # Validate plan name
        valid_plans = ['free', 'starter', 'standard', 'pro']
        if plan_name not in valid_plans:
            return jsonify({'error': f'Invalid plan name: {plan_name}. Valid plans: {", ".join(valid_plans)}'}), 400
            
        # Get user profile to verify existence
        user_data = get_user_usage(user_id)
        if not user_data:
            return jsonify({'error': f'User {user_id} not found'}), 404
            
        # Calculate new limits based on plan
        resume_limit = get_package_limit(plan_name, 'resumeAnalyses')
        interview_limit = get_package_limit(plan_name, 'mockInterviews')
        pdf_limit = get_package_limit(plan_name, 'pdfDownloads')
        ai_limit = get_package_limit(plan_name, 'aiEnhance')
        
        # Update user profile with new plan and RESET usage counters to 0
        user_ref = db.collection('users').document(user_id)
        update_data = {
            'plan': plan_name,
            'planPurchasedAt': datetime.now().isoformat(),
            'planExpiresAt': None,  # No expiration for now
            'usage.resumeAnalyses.limit': resume_limit,
            'usage.resumeAnalyses.used': 0,  # Reset to 0
            'usage.mockInterviews.limit': interview_limit,
            'usage.mockInterviews.used': 0,  # Reset to 0
            'usage.pdfDownloads.limit': pdf_limit,
            'usage.pdfDownloads.used': 0,  # Reset to 0
            'usage.aiEnhance.limit': ai_limit,
            'usage.aiEnhance.used': 0,  # Reset to 0
            'last_updated': firestore.SERVER_TIMESTAMP
        }
        
        user_ref.update(update_data)
        print(f"Updated user {user_id} to plan: {plan_name} with reset usage counters")
        
        return jsonify({
            'success': True,
            'plan': plan_name,
            'resumeLimit': resume_limit,
            'interviewLimit': interview_limit,
            'pdfLimit': pdf_limit,
            'aiLimit': ai_limit,
            'resumeUsed': 0,
            'interviewUsed': 0,
            'pdfUsed': 0,
            'aiUsed': 0
        })
        
    except Exception as e:
        print(f"Error in /update-user-plan: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}', 'success': False}), 500


@app.route('/get-user-usage/<user_id>', methods=['GET'])
def get_user_usage_route(user_id):
    """Returns usage statistics for a user."""
    try:
        if not user_id: return jsonify({'error': 'User ID required'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503
        
        user_data = get_user_usage(user_id)
        if not user_data:
            return jsonify({'error': f'User {user_id} not found'}), 404
            
        # Extract relevant information only
        usage_data = {
            'userId': user_id,
            'plan': user_data.get('plan', 'free'),
            'planPurchasedAt': user_data.get('planPurchasedAt'),
            'planExpiresAt': user_data.get('planExpiresAt'),
            'resumeAnalyses': user_data.get('usage', {}).get('resumeAnalyses', {'used': 0, 'limit': 0}),
            'mockInterviews': user_data.get('usage', {}).get('mockInterviews', {'used': 0, 'limit': 0})
        }
        
        return jsonify(usage_data)
        
    except Exception as e:
        print(f"Error in /get-user-usage: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/enhance-resume-content', methods=['POST'])
def enhance_resume_content_route():
    """Enhances a specific section of resume content using AI."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON payload'}), 400

        section_type = data.get('sectionType')
        original_content = data.get('originalContent')

        if not section_type or not original_content:
            return jsonify({'error': 'sectionType and originalContent are required'}), 400

        print(f"Received enhancement request for section: {section_type}")

        enhanced_content = call_haiku_for_enhancement(section_type, original_content)

        return jsonify({'enhancedContent': enhanced_content})

    except ValueError as ve: # Catch API key errors specifically
         print(f"Configuration Error: {ve}")
         return jsonify({'error': f'Server configuration error: {str(ve)}'}), 503 # Service Unavailable
    except Exception as e:
        print(f"Error in /enhance-resume-content route: {e}")
        traceback.print_exc()
        # Check if it's an Anthropic API error from call_claude_api
        if isinstance(e, Exception) and "Claude API" in str(e):
             # Pass Anthropic error message to frontend if possible
             return jsonify({'error': f'AI Enhancement Error: {str(e)}'}), 502 # Bad Gateway
        else:
            return jsonify({'error': f'Server error enhancing content: {str(e)}'}), 500

@app.route('/purchase-addon', methods=['POST'])
def purchase_addon():
    """Purchases an addon for a specific feature, increasing the user's limit."""
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON payload'}), 400
        
        user_id = data.get('userId')
        feature_type = data.get('feature')
        quantity = data.get('quantity', 1)  # Default to 1 if not specified
        payment_info = data.get('paymentInfo', {})  # Payment token or confirmation details
        
        if not user_id: return jsonify({'error': 'User ID required'}), 400
        if not feature_type: return jsonify({'error': 'Feature type required'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503
        
        # Validate feature type
        valid_features = ['resumeAnalyses', 'mockInterviews', 'pdfDownloads', 'aiEnhance']
        if feature_type not in valid_features:
            return jsonify({'error': f'Invalid feature type: {feature_type}. Valid features: {", ".join(valid_features)}'}), 400
            
        # Validate quantity
        try:
            quantity = int(quantity)
            if quantity <= 0:
                return jsonify({'error': 'Quantity must be greater than 0'}), 400
        except ValueError:
            return jsonify({'error': 'Quantity must be a valid number'}), 400
            
        # Get user profile
        user_data = get_user_usage(user_id)
        if not user_data:
            return jsonify({'error': f'User {user_id} not found'}), 404
            
        # Calculate addon price (example pricing - adjust as needed)
        addon_prices = {
            'resumeAnalyses': 19,  # ₹19 per resume analysis
            'mockInterviews': 89,  # ₹89 per mock interview
            'pdfDownloads': 9,     # ₹9 per 10 downloads
            'aiEnhance': 9         # ₹9 per 5 enhancements
        }
        
        # Special quantity adjustments (for bulk features like PDF downloads and AI enhance)
        quantity_multipliers = {
            'pdfDownloads': 10,  # 10 per purchase
            'aiEnhance': 5      # 5 per purchase
        }
        
        effective_quantity = quantity * quantity_multipliers.get(feature_type, 1)
        price_per_unit = addon_prices.get(feature_type, 0)
        total_price = price_per_unit * quantity
        
        # In a real implementation, process payment here using payment_info
        # For now, we'll assume payment was successful
        
        # Get current usage structure
        usage = user_data.get('usage', {}).get(feature_type, {})
        current_limit = usage.get('limit', 0)
        current_used = usage.get('used', 0)
        
        # Update user's limit for the feature
        user_ref = db.collection('users').document(user_id)
        update_data = {
            f'usage.{feature_type}.limit': current_limit + effective_quantity,
            'last_updated': firestore.SERVER_TIMESTAMP
        }
        
        # Record the addon purchase in a separate collection for tracking
        addon_purchase = {
            'userId': user_id,
            'feature': feature_type,
            'quantity': quantity,
            'effectiveQuantity': effective_quantity,
            'unitPrice': price_per_unit,
            'totalPrice': total_price,
            'purchaseDate': datetime.now().isoformat(),
            'previousLimit': current_limit,
            'newLimit': current_limit + effective_quantity,
            'usedAtPurchase': current_used
        }
        
        # Create a transaction to update user and record purchase atomically
        transaction = db.transaction()
        
        @firestore.transactional
        def update_in_transaction(transaction, user_ref, addon_purchase):
            # Update user limits
            transaction.update(user_ref, update_data)
            
            # Add purchase record
            purchase_ref = db.collection('addonPurchases').document()
            transaction.set(purchase_ref, addon_purchase)
            
            return purchase_ref.id
        
        purchase_id = update_in_transaction(transaction, user_ref, addon_purchase)
        
        print(f"User {user_id} purchased {quantity} {feature_type} addon(s) (effective: {effective_quantity})")
        
        return jsonify({
            'success': True,
            'purchaseId': purchase_id,
            'feature': feature_type,
            'quantityPurchased': quantity,
            'effectiveQuantity': effective_quantity,
            'previousLimit': current_limit,
            'newLimit': current_limit + effective_quantity,
            'price': total_price,
            'currency': 'INR',
            'currentUsage': current_used
        })
        
    except Exception as e:
        print(f"Error in /purchase-addon: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}', 'success': False}), 500


@app.route('/get-addon-pricing', methods=['GET'])
def get_addon_pricing():
    """Returns the current pricing information for add-ons."""
    try:
        # This could be stored in a database in the future for easier updates
        addon_pricing = {
            'resumeAnalyses': {
                'unitPrice': 19,
                'currency': 'INR',
                'description': 'Resume Analysis',
                'quantityMultiplier': 1  # 1 per purchase
            },
            'mockInterviews': {
                'unitPrice': 89,
                'currency': 'INR',
                'description': 'Mock Interview',
                'quantityMultiplier': 1  # 1 per purchase
            },
            'pdfDownloads': {
                'unitPrice': 9,
                'currency': 'INR',
                'description': 'PDF Download Pack',
                'quantityMultiplier': 10  # 10 per purchase
            },
            'aiEnhance': {
                'unitPrice': 9,
                'currency': 'INR',
                'description': 'AI Enhancement Pack',
                'quantityMultiplier': 5  # 5 per purchase
            }
        }
        
        return jsonify(addon_pricing)
    except Exception as e:
        print(f"Error in /get-addon-pricing: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/get-addon-purchase-history/<user_id>', methods=['GET'])
def get_addon_purchase_history(user_id):
    """Retrieves the addon purchase history for a user."""
    try:
        if not user_id: return jsonify({'error': 'User ID required'}), 400
        if not db: return jsonify({'error': 'Database unavailable'}), 503
        
        # Query the addon purchases collection for this user
        purchases_query = db.collection('addonPurchases').where('userId', '==', user_id).order_by('purchaseDate', direction=firestore.Query.DESCENDING)
        purchases = []
        
        for doc in purchases_query.stream():
            purchase_data = doc.to_dict()
            purchase_data['id'] = doc.id
            purchases.append(purchase_data)
        
        return jsonify({
            'userId': user_id,
            'purchases': purchases
        })
        
    except Exception as e:
        print(f"Error in /get-addon-purchase-history: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500

# Create Razorpay order
@app.route('/create-razorpay-order', methods=['POST'])
def create_razorpay_order():
    """Creates a Razorpay order for plan upgrade or addon purchase."""
    print("=== START: create-razorpay-order ===")
    try:
        if not razorpay_client:
            print("ERROR: Razorpay client not initialized")
            return jsonify({'error': 'Payment gateway not configured'}), 503
            
        data = request.get_json()
        if not data:
            print("ERROR: Invalid JSON payload received")
            return jsonify({'error': 'Invalid JSON payload'}), 400
            
        # Log received data for debugging (sanitize sensitive fields)
        safe_data = data.copy() if data else {}
        if 'userEmail' in safe_data:
            safe_data['userEmail'] = safe_data['userEmail'][0:4] + '****'
        print(f"Received order request: {safe_data}")
            
        # Required fields
        user_id = data.get('userId')
        amount = data.get('amount')  # In paise
        order_type = data.get('orderType', 'plan')  # 'plan' or 'addon'
        
        print(f"Processing order: type={order_type}, amount={amount}, userId={user_id}")
        
        if not user_id:
            print("ERROR: Missing userId in request")
            return jsonify({'error': 'User ID required'}), 400
        if not amount or not isinstance(amount, (int, float)) or amount <= 0:
            print(f"ERROR: Invalid amount: {amount}")
            return jsonify({'error': 'Valid amount required'}), 400
            
        # Validate user exists
        if not db:
            print("ERROR: Firestore database not available")
            return jsonify({'error': 'Database unavailable'}), 503
            
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        if not user_doc.exists:
            print(f"ERROR: User {user_id} not found in database")
            return jsonify({'error': 'User not found'}), 404
        
        print(f"User {user_id} verified in database")
            
        # Prepare order data - simplify to reduce potential errors
        order_data = {
            'amount': int(amount),  # Ensure integer
            'currency': data.get('currency', 'INR'),
            'receipt': f"o_{user_id[:8]}_{int(time.time())}",
            'payment_capture': 1,  # Auto-capture
            'notes': {
                'user_id': user_id,
                'order_type': order_type
            }
        }
        
        print(f"Prepared Razorpay order data: {order_data}")
        
        # Add specific notes based on order type
        if order_type == 'plan':
            plan_name = data.get('planName')
            if not plan_name:
                print("ERROR: planName missing for plan order")
                return jsonify({'error': 'Plan name required for plan orders'}), 400
                
            order_data['notes']['plan_name'] = plan_name
            print(f"Added plan name to order: {plan_name}")
            
        elif order_type == 'addon':
            feature_type = data.get('featureType')
            quantity = data.get('quantity')
            effective_quantity = data.get('effectiveQuantity')
            
            if not feature_type:
                print("ERROR: featureType missing for addon order")
                return jsonify({'error': 'Feature type required for addon orders'}), 400
            if not quantity or not isinstance(quantity, (int, float)) or quantity <= 0:
                print(f"ERROR: Invalid quantity for addon: {quantity}")
                return jsonify({'error': 'Valid quantity required for addon orders'}), 400
                
            order_data['notes']['feature_type'] = feature_type
            order_data['notes']['quantity'] = str(quantity)
            if effective_quantity:
                order_data['notes']['effective_quantity'] = str(effective_quantity)
            
            print(f"Added addon details: feature={feature_type}, quantity={quantity}, effective={effective_quantity}")
            
        # More detailed error handling for Razorpay API calls
        try:
            print("Calling Razorpay API to create order...")
            # Create order in Razorpay
            order = razorpay_client.order.create(data=order_data)
            print(f"Razorpay order created successfully: {order['id']}")
        except razorpay.errors.BadRequestError as e:
            print(f"Razorpay BadRequestError: {e}")
            # Log detailed error information
            error_msg = str(e)
            error_code = getattr(e, 'error_code', 'unknown')
            error_description = getattr(e, 'error_description', error_msg)
            print(f"Razorpay error details - Code: {error_code}, Description: {error_description}")
            
            return jsonify({
                'error': f'Payment gateway error: {error_msg}', 
                'details': 'Invalid order parameters',
                'code': error_code
            }), 400
        except razorpay.errors.ServerError as e:
            print(f"Razorpay ServerError: {e}")
            return jsonify({
                'error': f'Payment gateway server error: {str(e)}',
                'details': 'Please try again later'
            }), 502
        except Exception as e:
            print(f"Unexpected Razorpay error: {e}")
            traceback.print_exc()
            return jsonify({
                'error': f'Unexpected payment gateway error: {str(e)}',
                'details': 'Please try again later'
            }), 500
        
        # Store order reference in Firestore - keep a simplified version
        try:
            print(f"Storing order {order['id']} in Firestore...")
            order_ref = db.collection('payment_orders').document(order['id'])
            order_data_to_store = {
                'orderId': order['id'],
                'userId': user_id,
                'amount': order['amount'],
                'currency': order['currency'],
                'order_type': order_type,
                'status': 'created',
                'created_at': datetime.now().isoformat(),
                'payment_id': None,
                'payment_status': None
            }
            
            # Add specific data based on order type
            if order_type == 'plan':
                order_data_to_store['plan_name'] = plan_name
            elif order_type == 'addon':
                order_data_to_store['feature_type'] = feature_type
                order_data_to_store['quantity'] = int(quantity)
                if effective_quantity:
                    order_data_to_store['effective_quantity'] = int(effective_quantity)
                
            order_ref.set(order_data_to_store)
            print(f"Order {order['id']} stored successfully in Firestore")
        except Exception as db_error:
            print(f"Database error saving order {order['id']}: {db_error}")
            traceback.print_exc()
            # Continue anyway as order was created successfully in Razorpay
            print("Continuing despite Firestore error as Razorpay order was created successfully")
        
        # Return order details to client for Razorpay initialization
        response_data = {
            'key_id': RAZORPAY_KEY_ID,
            'amount': order['amount'],
            'currency': order['currency'],
            'razorpay_order_id': order['id']
        }
        print(f"Returning order details to client: {response_data}")
        print("=== END: create-razorpay-order ===")
        return jsonify(response_data)
        
    except razorpay.errors.BadRequestError as e:
        print(f"Razorpay Bad Request Error: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Payment gateway error: {str(e)}'}), 400
    except Exception as e:
        print(f"Unhandled error creating Razorpay order: {e}")
        traceback.print_exc()
        print("=== END WITH ERROR: create-razorpay-order ===")
        return jsonify({'error': f'Server error: {str(e)}'}), 500

# Verify Razorpay payment
@app.route('/verify-razorpay-payment', methods=['POST'])
def verify_razorpay_payment():
    """Verifies Razorpay payment signature and updates user plan or addon limit."""
    print("=== START: verify-razorpay-payment ===")
    try:
        if not razorpay_client:
            print("ERROR: Razorpay client not initialized")
            return jsonify({'error': 'Payment gateway not configured'}), 503
            
        data = request.get_json()
        if not data:
            print("ERROR: Invalid JSON payload received")
            return jsonify({'error': 'Invalid JSON payload'}), 400
            
        # Log received data for verification (sanitize sensitive fields)
        safe_data = data.copy() if data else {}
        if 'razorpay_signature' in safe_data:
            safe_data['razorpay_signature'] = safe_data['razorpay_signature'][:10] + '****'
        print(f"Received verification request: {safe_data}")
            
        # Required fields
        razorpay_order_id = data.get('razorpay_order_id')
        razorpay_payment_id = data.get('razorpay_payment_id')
        razorpay_signature = data.get('razorpay_signature')
        user_id = data.get('userId')
        order_type = data.get('orderType', 'plan')
        
        print(f"Verifying payment: order={razorpay_order_id}, payment={razorpay_payment_id}, type={order_type}")
        
        if not razorpay_order_id or not razorpay_payment_id or not razorpay_signature:
            print("ERROR: Missing required Razorpay verification parameters")
            return jsonify({'error': 'Missing required Razorpay verification parameters'}), 400
        if not user_id:
            print("ERROR: Missing userId in request")
            return jsonify({'error': 'User ID required'}), 400
            
        # Verify database connection
        if not db:
            print("ERROR: Firestore database not available")
            return jsonify({'error': 'Database unavailable'}), 503
            
        # Verify signature
        params_dict = {
            'razorpay_order_id': razorpay_order_id,
            'razorpay_payment_id': razorpay_payment_id,
            'razorpay_signature': razorpay_signature
        }
        
        try:
            print("Verifying Razorpay payment signature...")
            razorpay_client.utility.verify_payment_signature(params_dict)
            print("Signature verification successful")
        except Exception as sig_error:
            print(f"Signature verification failed: {sig_error}")
            traceback.print_exc()
            return jsonify({'success': False, 'error': 'Invalid payment signature'}), 400
            
        # Get order from Firestore
        print(f"Retrieving order {razorpay_order_id} from Firestore")
        order_ref = db.collection('payment_orders').document(razorpay_order_id)
        order_doc = order_ref.get()
        if not order_doc.exists:
            print(f"ERROR: Order {razorpay_order_id} not found in database")
            return jsonify({'success': False, 'error': 'Order not found in database'}), 404
            
        order_data = order_doc.to_dict()
        if order_data.get('payment_status') == 'completed':
            # Payment already processed, return success with stored data
            print(f"Payment for order {razorpay_order_id} was already processed, returning cached result")
            return jsonify({
                'success': True,
                'orderId': razorpay_order_id,
                'paymentId': order_data.get('payment_id'),
                'message': 'Payment was already processed successfully'
            })
            
        # Update order with payment details
        print(f"Updating order {razorpay_order_id} with payment details")
        order_ref.update({
            'payment_id': razorpay_payment_id,
            'signature': razorpay_signature,
            'payment_status': 'completed',
            'completed_at': datetime.now().isoformat()
        })
        
        # Get user reference
        user_ref = db.collection('users').document(user_id)
        
        # Handle plan upgrade
        if order_type == 'plan':
            plan_name = data.get('planName') or order_data.get('plan_name')
            if not plan_name:
                print(f"ERROR: Plan name not found for order {razorpay_order_id}")
                return jsonify({'success': False, 'error': 'Plan name not found'}), 400
            
            print(f"Processing plan upgrade to {plan_name} for user {user_id}")   
            
            # Calculate new limits based on the plan
            resume_limit = get_package_limit(plan_name, 'resumeAnalyses')
            interview_limit = get_package_limit(plan_name, 'mockInterviews')
            pdf_limit = get_package_limit(plan_name, 'pdfDownloads')
            ai_limit = get_package_limit(plan_name, 'aiEnhance')
            
            print(f"Calculated new limits: resume={resume_limit}, interview={interview_limit}, pdf={pdf_limit}, ai={ai_limit}")
            
            # Get user data to validate user exists
            user_data = get_user_usage(user_id)
            if not user_data:
                print(f"ERROR: User profile {user_id} not found")
                return jsonify({'success': False, 'error': 'User profile not found'}), 404
                
            # Log previous usage for reference only (not using in update)
            current_resume_used = user_data.get('usage', {}).get('resumeAnalyses', {}).get('used', 0)
            current_interview_used = user_data.get('usage', {}).get('mockInterviews', {}).get('used', 0)
            current_pdf_used = user_data.get('usage', {}).get('pdfDownloads', {}).get('used', 0)
            current_ai_used = user_data.get('usage', {}).get('aiEnhance', {}).get('used', 0)

            print(f"Previous usage (will be reset): resume={current_resume_used}, interview={current_interview_used}, pdf={current_pdf_used}, ai={current_ai_used}")

            # Update user profile with new plan and RESET usage counters to 0
            update_data = {
                'plan': plan_name,
                'planPurchasedAt': datetime.now().isoformat(),
                'planExpiresAt': None,  # No expiration for now
                'usage.resumeAnalyses.limit': resume_limit,
                'usage.resumeAnalyses.used': 0,  # Reset to 0
                'usage.mockInterviews.limit': interview_limit,
                'usage.mockInterviews.used': 0,  # Reset to 0
                'usage.pdfDownloads.limit': pdf_limit,
                'usage.pdfDownloads.used': 0,  # Reset to 0
                'usage.aiEnhance.limit': ai_limit,
                'usage.aiEnhance.used': 0,  # Reset to 0
                'last_updated': firestore.SERVER_TIMESTAMP
            }
            
            print(f"Preparing to update user profile with new plan data")
            
            # Record the payment in payments collection
            payment_data = {
                'userId': user_id,
                'orderId': razorpay_order_id,
                'paymentId': razorpay_payment_id,
                'amount': order_data.get('amount', 0) / 100,  # Convert from paise to rupees
                'currency': order_data.get('currency', 'INR'),
                'type': 'plan_upgrade',
                'planName': plan_name,
                'status': 'completed',
                'timestamp': datetime.now().isoformat()
            }
            
            print(f"Preparing payment record: {payment_data}")
            
            # Create a transaction to update multiple documents atomically
            transaction = db.transaction()
            print(f"Starting Firestore transaction for plan upgrade")
            
            @firestore.transactional
            def update_in_transaction(transaction, user_ref, payment_data):
                # Update user plan
                transaction.update(user_ref, update_data)
                print(f"Transaction: Updated user plan in transaction")
                
                # Add payment record
                payment_ref = db.collection('payments').document()
                transaction.set(payment_ref, payment_data)
                print(f"Transaction: Added payment record in transaction")
                
                return payment_ref.id
                
            try:
                payment_id = update_in_transaction(transaction, user_ref, payment_data)
                print(f"Transaction completed successfully. Payment record ID: {payment_id}")
            except Exception as tx_error:
                print(f"Transaction failed: {tx_error}")
                traceback.print_exc()
                return jsonify({'success': False, 'error': f'Database update failed: {str(tx_error)}'}), 500
            
            print(f"Plan upgrade completed successfully for user {user_id}")
            print("=== END: verify-razorpay-payment ===")
            
            return jsonify({
                'success': True,
                'plan': plan_name,
                'orderId': razorpay_order_id,
                'paymentId': razorpay_payment_id,
                'resumeLimit': resume_limit,
                'interviewLimit': interview_limit,
                'pdfLimit': pdf_limit,
                'aiLimit': ai_limit
            })
            
        # Handle addon purchase
        elif order_type == 'addon':
            feature_type = data.get('featureType') or order_data.get('feature_type')
            quantity = int(data.get('quantity') or order_data.get('quantity', 1))
            effective_quantity = int(data.get('effectiveQuantity') or order_data.get('effective_quantity', quantity))
            
            if not feature_type:
                print(f"ERROR: Feature type not found for addon purchase {razorpay_order_id}")
                return jsonify({'success': False, 'error': 'Feature type not found'}), 400
                
            print(f"Processing addon purchase: feature={feature_type}, quantity={quantity}, effective={effective_quantity}")
            
            # Get current usage
            user_data = get_user_usage(user_id)
            if not user_data:
                print(f"ERROR: User profile {user_id} not found")
                return jsonify({'success': False, 'error': 'User profile not found'}), 404
                
            # Get current limit and used values
            usage = user_data.get('usage', {}).get(feature_type, {})
            current_limit = usage.get('limit', 0)
            current_used = usage.get('used', 0)
            
            # Calculate new limit
            new_limit = current_limit + effective_quantity
            print(f"Current limit: {current_limit}, Current used: {current_used}, New limit: {new_limit}")
            
            # Update user's limit
            update_data = {
                f'usage.{feature_type}.limit': new_limit,
                'last_updated': firestore.SERVER_TIMESTAMP
            }
            
            # Record addon purchase
            addon_purchase = {
                'userId': user_id,
                'orderId': razorpay_order_id,
                'paymentId': razorpay_payment_id,
                'feature': feature_type,
                'quantity': quantity,
                'effectiveQuantity': effective_quantity,
                'unitPrice': order_data.get('amount', 0) / quantity / 100,  # Convert from paise to rupees
                'totalPrice': order_data.get('amount', 0) / 100,  # Convert from paise to rupees
                'currency': order_data.get('currency', 'INR'),
                'purchaseDate': datetime.now().isoformat(),
                'previousLimit': current_limit,
                'newLimit': new_limit,
                'usedAtPurchase': current_used
            }
            
            print(f"Prepared addon purchase record: {addon_purchase}")
            
            # Create a transaction
            transaction = db.transaction()
            print(f"Starting Firestore transaction for addon purchase")
            
            @firestore.transactional
            def update_addon_in_transaction(transaction, user_ref, addon_purchase):
                # Update user limits
                transaction.update(user_ref, update_data)
                print(f"Transaction: Updated user limits in transaction")
                
                # Add purchase record
                purchase_ref = db.collection('addonPurchases').document()
                transaction.set(purchase_ref, addon_purchase)
                print(f"Transaction: Added purchase record in transaction")
                
                # Add payment record
                payment_data = {
                    'userId': user_id,
                    'orderId': razorpay_order_id,
                    'paymentId': razorpay_payment_id,
                    'amount': addon_purchase['totalPrice'],
                    'currency': addon_purchase['currency'],
                    'type': 'addon_purchase',
                    'featureType': feature_type,
                    'quantity': quantity,
                    'effectiveQuantity': effective_quantity,
                    'status': 'completed',
                    'timestamp': datetime.now().isoformat()
                }
                print(f"Transaction: Prepared payment record")
                
                payment_ref = db.collection('payments').document()
                transaction.set(payment_ref, payment_data)
                print(f"Transaction: Added payment record in transaction")
                
                return purchase_ref.id
            
            try:    
                purchase_id = update_addon_in_transaction(transaction, user_ref, addon_purchase)
                print(f"Transaction completed successfully. Purchase record ID: {purchase_id}")
            except Exception as tx_error:
                print(f"Transaction failed: {tx_error}")
                traceback.print_exc()
                return jsonify({'success': False, 'error': f'Database update failed: {str(tx_error)}'}), 500
            
            print(f"Addon purchase completed successfully for user {user_id}")
            print("=== END: verify-razorpay-payment ===")
            
            return jsonify({
                'success': True,
                'purchaseId': purchase_id,
                'orderId': razorpay_order_id,
                'paymentId': razorpay_payment_id,
                'feature': feature_type,
                'quantityPurchased': quantity,
                'effectiveQuantity': effective_quantity,
                'previousLimit': current_limit,
                'newLimit': new_limit,
                'currentUsage': current_used
            })
            
        else:
            print(f"ERROR: Unknown order type: {order_type}")
            return jsonify({'success': False, 'error': f'Unknown order type: {order_type}'}), 400
            
    except Exception as e:
        print(f"Unhandled error verifying Razorpay payment: {e}")
        traceback.print_exc()
        print("=== END WITH ERROR: verify-razorpay-payment ===")
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500

# Add a route to record payment failure for analytics
@app.route('/record-payment-failure', methods=['POST'])
def record_payment_failure():
    """Records payment failure reasons for analytics."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON payload'}), 400
            
        user_id = data.get('userId')
        order_id = data.get('orderId')
        reason = data.get('reason')
        
        if not user_id or not order_id:
            return jsonify({'error': 'User ID and order ID required'}), 400
            
        if not db:
            return jsonify({'error': 'Database unavailable'}), 503
            
        # Record failure
        failure_data = {
            'userId': user_id,
            'orderId': order_id,
            'reason': reason,
            'timestamp': datetime.now().isoformat(),
            'userAgent': request.headers.get('User-Agent'),
            'ipAddress': request.remote_addr
        }
        
        db.collection('payment_failures').add(failure_data)
        
        return jsonify({'success': True})
        
    except Exception as e:
        print(f"Error recording payment failure: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/payment-webhooks', methods=['POST'])
def payment_webhooks():
    """Handles Razorpay webhook events for payments and refunds."""
    print("=== START: payment-webhooks ===")
    try:
        # Get the raw request data and Razorpay signature
        webhook_data = request.data
        webhook_signature = request.headers.get('X-Razorpay-Signature')
        
        if not webhook_signature:
            print("ERROR: Missing X-Razorpay-Signature header in webhook request")
            return jsonify({'error': 'Invalid webhook signature'}), 400
            
        # Verify webhook signature
        try:
            # The webhook secret should be stored in environment variables
            webhook_secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET")
            if not webhook_secret:
                print("ERROR: RAZORPAY_WEBHOOK_SECRET not configured")
                return jsonify({'error': 'Webhook secret not configured'}), 500
                
            # Verify webhook signature using the hmac library
            expected_signature = hmac.new(
                webhook_secret.encode(),
                webhook_data,
                hashlib.sha256
            ).hexdigest()
            
            # Use constant time comparison to prevent timing attacks
            if not compare_digest(webhook_signature, expected_signature):
                print("ERROR: Invalid webhook signature")
                return jsonify({'error': 'Invalid webhook signature'}), 401
                
        except Exception as sig_error:
            print(f"ERROR: Webhook signature verification failed: {sig_error}")
            return jsonify({'error': 'Webhook signature verification failed'}), 401
            
        # Parse the JSON payload
        event_data = json.loads(webhook_data)
        event_type = event_data.get('event')
        
        if not event_type:
            print("ERROR: Missing event type in webhook data")
            return jsonify({'error': 'Missing event type'}), 400
            
        print(f"Processing Razorpay webhook event: {event_type}")
        
        # Extract common fields for logging
        payment_id = event_data.get('payload', {}).get('payment', {}).get('entity', {}).get('id')
        order_id = event_data.get('payload', {}).get('payment', {}).get('entity', {}).get('order_id')
        
        # Create webhook record for all events
        if db:
            webhook_record = {
                'event_type': event_type,
                'payment_id': payment_id,
                'order_id': order_id,
                'received_at': datetime.now().isoformat(),
                'raw_data': json.dumps(event_data)[:10000]  # Limit size for storage
            }
            db.collection('webhook_events').add(webhook_record)
            print(f"Webhook event recorded: {event_type}")
        
        # Process based on event type
        if event_type == 'payment.authorized':
            # Payment was authorized but not yet captured
            print(f"Payment authorized: payment_id={payment_id}, order_id={order_id}")
            
            if db and order_id:
                order_ref = db.collection('payment_orders').document(order_id)
                order_doc = order_ref.get()
                
                if order_doc.exists:
                    order_ref.update({
                        'payment_id': payment_id,
                        'payment_status': 'authorized',
                        'authorized_at': datetime.now().isoformat(),
                        'webhook_events': firestore.ArrayUnion([event_type])
                    })
                    print(f"Order {order_id} updated with authorized status")
            
        elif event_type == 'payment.captured':
            # Payment was successfully captured (final success state)
            print(f"Payment captured: payment_id={payment_id}, order_id={order_id}")
            
            if not db:
                print("ERROR: Database unavailable")
                return jsonify({'error': 'Database unavailable'}), 503
                
            if order_id:
                order_ref = db.collection('payment_orders').document(order_id)
                order_doc = order_ref.get()
                
                if order_doc.exists:
                    order_data = order_doc.to_dict()
                    
                    # Check if payment was already processed
                    if order_data.get('payment_status') == 'completed':
                        print(f"Payment for order {order_id} was already processed")
                        return jsonify({'status': 'success', 'message': 'Payment already processed'}), 200
                    
                    # Update order status
                    order_ref.update({
                        'payment_id': payment_id,
                        'payment_status': 'completed',
                        'webhook_processed': True,
                        'completed_at': datetime.now().isoformat(),
                        'webhook_events': firestore.ArrayUnion([event_type])
                    })
                    
                    # Process the payment based on order type
                    # This should be similar to your verify-razorpay-payment logic
                    # For plan purchases, update user plan
                    # For addon purchases, update user limits
                    process_captured_payment(order_data, payment_id)
                    
                    print(f"Webhook processed successfully for captured payment {payment_id}")
                else:
                    print(f"Order {order_id} not found for captured payment {payment_id}")
            
        elif event_type == 'payment.failed':
            # Payment failed
            print(f"Payment failed: payment_id={payment_id}, order_id={order_id}")
            
            if db and order_id:
                order_ref = db.collection('payment_orders').document(order_id)
                order_doc = order_ref.get()
                
                if order_doc.exists:
                    # Get failure details
                    failure_reason = event_data.get('payload', {}).get('payment', {}).get('entity', {}).get('error_code')
                    failure_description = event_data.get('payload', {}).get('payment', {}).get('entity', {}).get('error_description')
                    
                    order_ref.update({
                        'payment_id': payment_id,
                        'payment_status': 'failed',
                        'failure_reason': failure_reason,
                        'failure_description': failure_description,
                        'webhook_processed': True,
                        'failed_at': datetime.now().isoformat(),
                        'webhook_events': firestore.ArrayUnion([event_type])
                    })
                    print(f"Order {order_id} updated with failed status: {failure_reason}")
            
        elif event_type == 'refund.created':
            # Refund was created but not yet processed
            refund_id = event_data.get('payload', {}).get('refund', {}).get('entity', {}).get('id')
            refund_amount = event_data.get('payload', {}).get('refund', {}).get('entity', {}).get('amount')
            
            print(f"Refund created: refund_id={refund_id}, payment_id={payment_id}, amount={refund_amount}")
            
            if db and payment_id:
                # Create refund record
                refund_record = {
                    'refund_id': refund_id,
                    'payment_id': payment_id,
                    'order_id': order_id,
                    'amount': refund_amount,
                    'status': 'created',
                    'created_at': datetime.now().isoformat(),
                    'webhook_events': [event_type]
                }
                db.collection('refunds').document(refund_id).set(refund_record)
                print(f"Refund record created for refund {refund_id}")
            
        elif event_type == 'refund.processed':
            # Refund was successfully processed
            refund_id = event_data.get('payload', {}).get('refund', {}).get('entity', {}).get('id')
            refund_amount = event_data.get('payload', {}).get('refund', {}).get('entity', {}).get('amount')
            
            print(f"Refund processed: refund_id={refund_id}, payment_id={payment_id}, amount={refund_amount}")
            
            if db and refund_id:
                # Update refund record
                refund_ref = db.collection('refunds').document(refund_id)
                refund_ref.update({
                    'status': 'processed',
                    'processed_at': datetime.now().isoformat(),
                    'webhook_events': firestore.ArrayUnion([event_type])
                })
                
                # Also update related order if possible
                if order_id:
                    order_ref = db.collection('payment_orders').document(order_id)
                    order_ref.update({
                        'refund_status': 'processed',
                        'refund_amount': refund_amount,
                        'refund_id': refund_id,
                        'refunded_at': datetime.now().isoformat(),
                        'webhook_events': firestore.ArrayUnion([event_type])
                    })
                    print(f"Order {order_id} updated with refund status")
            
        elif event_type == 'refund.failed':
            # Refund failed
            refund_id = event_data.get('payload', {}).get('refund', {}).get('entity', {}).get('id')
            failure_reason = event_data.get('payload', {}).get('refund', {}).get('entity', {}).get('error_code')
            failure_description = event_data.get('payload', {}).get('refund', {}).get('entity', {}).get('error_description')
            
            print(f"Refund failed: refund_id={refund_id}, payment_id={payment_id}, reason={failure_reason}")
            
            if db and refund_id:
                # Update refund record
                refund_ref = db.collection('refunds').document(refund_id)
                refund_ref.update({
                    'status': 'failed',
                    'failure_reason': failure_reason,
                    'failure_description': failure_description,
                    'failed_at': datetime.now().isoformat(),
                    'webhook_events': firestore.ArrayUnion([event_type])
                })
                
                # Also update related order if possible
                if order_id:
                    order_ref = db.collection('payment_orders').document(order_id)
                    order_ref.update({
                        'refund_status': 'failed',
                        'refund_failure_reason': failure_reason,
                        'webhook_events': firestore.ArrayUnion([event_type])
                    })
                    print(f"Order {order_id} updated with failed refund status")
                    
        else:
            # Other event types - just log them
            print(f"Received unhandled webhook event type: {event_type}")
            
        # Always return 200 OK for webhook - even for unhandled events
        # This prevents Razorpay from retrying the webhook
        print("=== END: payment-webhooks ===")
        return jsonify({'status': 'success'}), 200
        
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in webhook payload: {e}")
        return jsonify({'error': 'Invalid JSON payload'}), 400
    except Exception as e:
        print(f"Unhandled error processing webhook: {e}")
        traceback.print_exc()
        print("=== END WITH ERROR: payment-webhooks ===")
        return jsonify({'error': f'Server error: {str(e)}'}), 500






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