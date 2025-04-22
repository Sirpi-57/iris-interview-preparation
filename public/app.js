// IRIS - Interview Readiness & Improvement System
// Main JavaScript file (with Firebase authentication integration)

// Global State
const state = {
    sessionId: null,
    interviewId: null,
    mediaRecorder: null,
    audioChunks: [],
    isRecording: false,
    recordingStartTime: null,
    recordingTimer: null,
    videoStream: null,
    interviewType: 'general',
    conversationHistory: [],

    // Voice detection state
    isInterviewActive: false,
    isAIResponding: false,
    silenceTimer: null,
    silenceDelay: 2500,
    audioContext: null,
    analyserNode: null,
    audioSourceNode: null,
    audioDataArray: null,
    vadAnimationFrameId: null,
    speechDetectedInChunk: false,
};

// VAD Constants
const SPEECH_THRESHOLD = 55;
const FFT_SIZE = 256;

// API Base URL
const API_BASE_URL = 'https://iris-ai-backend.onrender.com';

// DOM Elements Cache
const DOMElements = {
    sidebar: document.getElementById('sidebar'),
    content: document.getElementById('content'),
};

document.addEventListener('DOMContentLoaded', function() {
    // Check if Firebase auth is initialized
    if (typeof irisAuth !== 'undefined') {
        console.log('Firebase Auth module detected');
    } else {
        console.warn('Firebase Auth module not found, some features may be limited');
    }

    // Initialize UI interactions
    initNavigation();
    initButtons();
    initForms();
    initProfilePage();

    // Load available browser voices (for fallback TTS)
    loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }

    // Check browser support
    checkBrowserSupport();
});

// --- Authentication-related Functions ---

// --- Updated initializeIRISApp function ---
function initializeIRISApp() {
    console.log('Initializing IRIS app for authenticated user...');

    // Reset global state potentially tied to previous user/session
    state.sessionId = null;
    state.interviewId = null;

    const userProfile = irisAuth?.getUserProfile();

     if (!userProfile) {
         console.warn("User profile not loaded yet, cannot check for last session.");
         lockAllSections();
         navigateTo('upload');
         return;
     }
     
     // Update usage display
     updateUsageDisplay();

    const lastSessionId = userProfile.lastActiveSessionId;

    if (lastSessionId) {
        console.log(`Found last active session ID from user profile: ${lastSessionId}`);
        checkAndLoadSessionStatus(lastSessionId);
    } else {
        console.log("No last active session found for this user. Starting fresh.");
        lockAllSections();
        navigateTo('upload');
    }
}

// Replace this entire function in app.js
function initProfilePage() {
    // --- Profile Edit Logic ---
    document.getElementById('editProfileBtn')?.addEventListener('click', function() {
        document.getElementById('profileViewMode').style.display = 'none';
        document.getElementById('profileEditForm').style.display = 'block';
        const user = irisAuth?.getCurrentUser();
        const profile = irisAuth?.getUserProfile();
        if (user) {
            document.getElementById('profileName').value = user.displayName || profile?.displayName || '';
            document.getElementById('profileEmail').value = user.email || '';
        }
    });
    document.getElementById('cancelEditBtn')?.addEventListener('click', function() {
        document.getElementById('profileViewMode').style.display = 'block';
        document.getElementById('profileEditForm').style.display = 'none';
    });
    document.getElementById('profileEditForm')?.addEventListener('submit', function(e) {
        e.preventDefault();
        const newName = document.getElementById('profileName').value.trim();
        const user = firebase.auth().currentUser;
        if (user) {
            const submitBtn = this.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
            user.updateProfile({ displayName: newName })
                .then(() => {
                    if (firebase.firestore) {
                        return firebase.firestore().collection('users').doc(user.uid).update({
                            displayName: newName,
                            updatedAt: new Date().toISOString()
                        });
                    }
                })
                .then(() => {
                    document.getElementById('profileViewMode').style.display = 'block';
                    document.getElementById('profileEditForm').style.display = 'none';
                    document.querySelectorAll('.user-display-name').forEach(el => { el.textContent = newName; });
                    showMessage('Profile updated successfully!', 'success');
                })
                .catch(error => {
                    console.error('Error updating profile:', error);
                    showMessage(`Error updating profile: ${error.message}`, 'danger');
                })
                .finally(() => {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                });
        }
    });

    // --- Change Password Logic (Modified Check) ---
    document.getElementById('changePasswordBtn')?.addEventListener('click', function() {
        const user = firebase.auth().currentUser;
        // Check if user exists and has a password provider linked
        const hasPasswordProvider = user?.providerData.some(p => p.providerId === 'password');

        if (hasPasswordProvider) {
             // Only show change password modal if password is set
             const modal = new bootstrap.Modal(document.getElementById('change-password-modal'));
             modal.show();
        } else {
            showMessage('You need to set a password first before changing it. Click "Enable Email/Password Sign-in".', 'info');
            // Optionally, you could directly trigger the 'add password' modal here if desired:
            // showAddPasswordModal();
        }
    });
    document.getElementById('change-password-form')?.addEventListener('submit', function(e) {
        e.preventDefault();
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-new-password').value;
        if (newPassword !== confirmPassword) {
            showMessage('New passwords do not match', 'danger'); return;
        }
        if (newPassword.length < 6) {
             showMessage('New password must be at least 6 characters.', 'warning'); return;
        }
        const user = firebase.auth().currentUser;
        if (user) {
            const submitBtn = this.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Updating...';
            const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
            user.reauthenticateWithCredential(credential)
                .then(() => user.updatePassword(newPassword))
                .then(() => {
                    bootstrap.Modal.getInstance(document.getElementById('change-password-modal')).hide();
                    showMessage('Password updated successfully!', 'success');
                    document.getElementById('change-password-form').reset(); // Clear form
                })
                .catch(error => {
                    console.error('Error updating password:', error);
                    if (error.code === 'auth/wrong-password') {
                        showMessage('Current password is incorrect', 'danger');
                    } else if (error.code === 'auth/requires-recent-login') {
                         showMessage('This operation requires a recent sign-in. Please sign out and sign back in, then try again.', 'warning');
                    } else {
                        showMessage(`Error updating password: ${error.message}`, 'danger');
                    }
                })
                .finally(() => {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                });
        }
    });

    // --- Add Password Logic (New) ---
    const addPasswordBtn = document.getElementById('addPasswordBtn');
    if (addPasswordBtn) {
        // Initial check is done in firebase-auth.js's updateUserProfileUI
        addPasswordBtn.addEventListener('click', showAddPasswordModal); // Attach listener
    }

    // Listener for the new Add Password modal's form
    document.getElementById('add-password-form')?.addEventListener('submit', function(e) {
        e.preventDefault();
        const newPassword = document.getElementById('add-new-password').value;
        const confirmPassword = document.getElementById('add-confirm-new-password').value;
        const user = firebase.auth().currentUser;

        if (!user || !user.email) {
            showMessage('User not found or email missing.', 'danger'); return;
        }
        if (newPassword.length < 6) {
             showMessage('Password must be at least 6 characters long.', 'warning'); return;
        }
        if (newPassword !== confirmPassword) {
            showMessage('Passwords do not match.', 'danger'); return;
        }

        // Show loading state
        const submitBtn = this.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Setting Password...';

        // Create the Email/Password credential to link
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, newPassword);

        // Link the credential to the existing signed-in user
        user.linkWithCredential(credential)
            .then(() => {
                showMessage('Password set successfully! You can now sign in using your email and this password.', 'success');
                bootstrap.Modal.getInstance(document.getElementById('add-password-modal')).hide();

                // Update button visibility: Hide "Add", Show "Change"
                document.getElementById('addPasswordBtn').style.display = 'none';
                document.getElementById('changePasswordBtn').style.display = 'block';

                 // Clear the add password form
                 document.getElementById('add-password-form').reset();
            })
            .catch((error) => {
                console.error('Error linking password credential:', error);
                // Handle specific errors
                if (error.code === 'auth/requires-recent-login') {
                    showMessage('This operation requires a recent sign-in. Please sign out and sign back in, then try again.', 'warning');
                    // Consider forcing sign out: irisAuth.signOut();
                } else if (error.code === 'auth/credential-already-in-use' || error.code === 'auth/email-already-in-use') {
                     showMessage('Error: This email address is already associated with another account using a password. Cannot link.', 'danger');
                } else if (error.code === 'auth/provider-already-linked') {
                     showMessage('Error: A password provider is already linked to this account.', 'warning');
                     // Update UI just in case it was out of sync
                     document.getElementById('addPasswordBtn').style.display = 'none';
                     document.getElementById('changePasswordBtn').style.display = 'block';
                     bootstrap.Modal.getInstance(document.getElementById('add-password-modal')).hide();
                     document.getElementById('add-password-form').reset();
                }
                else {
                     showMessage(`Failed to set password: ${error.message}`, 'danger');
                }
            })
            .finally(() => {
                // Restore button state
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            });
    });

    // --- Delete Account Logic (Existing) ---
    document.getElementById('deleteAccountBtn')?.addEventListener('click', function() {
        const modal = new bootstrap.Modal(document.getElementById('delete-account-modal'));
        modal.show();
    });
    document.getElementById('delete-confirmation')?.addEventListener('input', function() {
        const deleteBtn = document.getElementById('confirm-delete-btn');
        deleteBtn.disabled = this.value !== 'DELETE';
    });
    document.getElementById('delete-account-form')?.addEventListener('submit', function(e) {
         e.preventDefault();
         const password = document.getElementById('delete-password').value;
         const confirmation = document.getElementById('delete-confirmation').value;
         if (confirmation !== 'DELETE') { /* ... */ return; }
         const user = firebase.auth().currentUser;
         if (user) {
             const submitBtn = this.querySelector('button[type="submit"]');
             const originalText = submitBtn.innerHTML;
             submitBtn.disabled = true;
             submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Deleting...';
             const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
             user.reauthenticateWithCredential(credential)
                 .then(() => {
                     // Firestore cleanup (existing logic)
                     if (firebase.firestore) {
                         const batch = firebase.firestore().batch();
                         batch.delete(firebase.firestore().collection('users').doc(user.uid));
                         return firebase.firestore().collection('sessions').where('userId', '==', user.uid).get()
                             .then(snapshot => { snapshot.forEach(doc => batch.delete(doc.ref)); return firebase.firestore().collection('interviews').where('userId', '==', user.uid).get(); })
                             .then(snapshot => { snapshot.forEach(doc => batch.delete(doc.ref)); return batch.commit(); });
                     }
                 })
                 .then(() => user.delete()) // Delete Firebase Auth user
                 .then(() => {
                     bootstrap.Modal.getInstance(document.getElementById('delete-account-modal')).hide();
                     showMessage('Your account has been deleted successfully', 'success');
                     // Auth state listener will handle UI changes
                 })
                 .catch(error => { /* ... (existing error handling) ... */ })
                 .finally(() => { /* ... (restore button) ... */ });
         }
    });

    // --- Placeholder Logic (Existing) ---
    document.getElementById('upgradePlanBtn')?.addEventListener('click', function() {
        showPaymentModal(); // Placeholder function
    });
    document.getElementById('downloadDataBtn')?.addEventListener('click', function() {
        downloadUserData(); // Client-side download function
    });

    // --- Helper function to show the Add Password Modal ---
    // Defined within initProfilePage scope or globally if preferred
    function showAddPasswordModal() {
        const user = firebase.auth().currentUser;
        if (!user || !user.email) {
            showMessage('Cannot set password. User not logged in or email is missing.', 'warning');
            return;
        }
         // Double-check if password provider exists before showing
        const hasPasswordProvider = user.providerData.some(p => p.providerId === 'password');
        if(hasPasswordProvider) {
             showMessage('Password is already set for this account.', 'info');
             // Ensure button visibility is correct
             document.getElementById('addPasswordBtn').style.display = 'none';
             document.getElementById('changePasswordBtn').style.display = 'block';
             return; // Don't show the modal
        }

        document.getElementById('add-password-email').textContent = user.email; // Show email in modal
        // Clear form fields before showing
        document.getElementById('add-password-form').reset();
        const modal = new bootstrap.Modal(document.getElementById('add-password-modal'));
        modal.show();
    }

    updateUsageDisplay();

    // --- Add upgrade button listener in profile page ---
    document.getElementById('upgradePlanBtn')?.addEventListener('click', showPaymentModal);

} // End of initProfilePage function definition

// --- Replace showPaymentModal function ---
function showPaymentModal() {
    // Get the current plan
    const currentPlan = irisAuth?.getUserProfile()?.plan || 'free';
    
    // Show the upgrade modal with appropriate features highlighted
    showUpgradeModal(currentPlan === 'free' ? 'resumeAnalyses' : 'mockInterviews');
}

function downloadUserData() {
    // Placeholder for user data download
    const user = firebase.auth().currentUser;
    if (!user || !firebase.firestore) {
        showMessage('Unable to download data at this time', 'danger');
        return;
    }
    
    // Show loading message
    showMessage('Preparing your data for download...', 'info');
    
    // Collect user data from Firestore
    const userData = {
        profile: null,
        sessions: [],
        interviews: []
    };
    
    // Get user profile
    firebase.firestore().collection('users').doc(user.uid).get()
        .then(doc => {
            if (doc.exists) {
                userData.profile = doc.data();
            }
            
            // Get user sessions
            return firebase.firestore().collection('sessions')
                .where('userId', '==', user.uid)
                .get();
        })
        .then(snapshot => {
            snapshot.forEach(doc => {
                userData.sessions.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            // Get user interviews
            return firebase.firestore().collection('interviews')
                .where('userId', '==', user.uid)
                .get();
        })
        .then(snapshot => {
            snapshot.forEach(doc => {
                userData.interviews.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            // Create and download JSON file
            const dataStr = JSON.stringify(userData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `iris-data-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showMessage('Your data has been downloaded', 'success');
        })
        .catch(error => {
            console.error('Error downloading user data:', error);
            showMessage(`Error downloading data: ${error.message}`, 'danger');
        });
}

function showMessage(message, type = 'info') {
    const errorContainer = document.getElementById('error-messages');
    if (!errorContainer) {
        console.warn('Error messages container not found');
        alert(message); // Fallback to alert
        return;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `alert alert-${type} alert-dismissible fade show`;
    messageDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    errorContainer.appendChild(messageDiv);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        messageDiv.classList.remove('show');
        setTimeout(() => messageDiv.remove(), 500);
    }, 5000);
}

// --- Original IRIS Functions ---

function loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    console.log('Available browser voices:', voices.map(v => `${v.name} (${v.lang})`));
    // You could potentially try to find an Indian voice here for the fallback
    // state.fallbackVoice = voices.find(voice => voice.lang === 'en-IN');
}

function checkBrowserSupport() {
     if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support the necessary media features for the interactive interview. Please use a modern browser like Chrome, Firefox, or Edge.');
    }
    // MediaRecorder support is crucial for sending audio
    if (typeof MediaRecorder === 'undefined') {
         alert('Your browser does not support the MediaRecorder API needed for voice input.');
    }
}

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const targetSection = this.getAttribute('data-target');
            // Prevent navigation if locked (unless it's the upload/landing section)
            const isLocked = this.querySelector('.status-indicator.locked');
            if (this.classList.contains('active') || (isLocked && targetSection !== 'upload' && targetSection !== 'landing')) {
                return;
            }

            // Switch active nav item
            document.querySelector('.nav-item.active')?.classList.remove('active');
            this.classList.add('active');

            // Switch active content section
            document.querySelector('.content-section.active')?.classList.remove('active');
            document.getElementById(targetSection)?.classList.add('active');

            // Special actions when navigating
            if (targetSection === 'history') {
                loadProgressHistory();
            }
        });
    });
}

function initButtons() {
    // --- General Navigation --- [Keep existing code]
    document.getElementById('getStartedBtn')?.addEventListener('click', () => navigateTo('upload'));
    document.getElementById('viewPrepPlanBtn')?.addEventListener('click', () => navigateTo('prep-plan'));
    document.getElementById('startInterviewBtn')?.addEventListener('click', () => {
        // Add feature check here
        if (checkFeatureAccess('mockInterviews')) {
            navigateTo('mock-interview');
            showPermissionsModal();
        }
    });
    document.getElementById('startNewInterviewBtn')?.addEventListener('click', () => {
        // Add feature check here
        if (checkFeatureAccess('mockInterviews')) {
            navigateTo('mock-interview');
            showPermissionsModal();
        }
    });
    document.getElementById('viewProgressBtn')?.addEventListener('click', () => navigateTo('history'));
    document.getElementById('startAnotherInterviewBtn')?.addEventListener('click', () => {
        // Add feature check here
        if (checkFeatureAccess('mockInterviews')) {
            navigateTo('mock-interview');
            showPermissionsModal();
        }
    });

    // --- Mock Interview Controls --- [Keep existing code]
    document.getElementById('endInterviewBtn')?.addEventListener('click', endInterview);

    const interviewTypeButtons = document.querySelectorAll('#interviewTypeSelector button');
    interviewTypeButtons.forEach(button => {
        button.addEventListener('click', function() {
            interviewTypeButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            state.interviewType = this.getAttribute('data-type');
        });
    });

    document.getElementById('toggleCameraBtn')?.addEventListener('click', toggleCamera);
    document.getElementById('toggleMicBtn')?.addEventListener('click', toggleMicrophone);

    // Text input (still useful as a backup or alternative)
    document.getElementById('sendReplyBtn')?.addEventListener('click', sendTextReply);
    document.getElementById('userReplyInput')?.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') sendTextReply();
    });

    // Permissions Modal
    document.getElementById('grantPermissionsBtn')?.addEventListener('click', setupMediaDevices);

    // Recording Buttons (hidden/repurposed for continuous mode)
    const voiceReplyBtn = document.getElementById('voiceReplyBtn');
    const stopRecordingBtn = document.getElementById('stopRecordingBtn');
    if(voiceReplyBtn) voiceReplyBtn.style.display = 'none';
    if(stopRecordingBtn) stopRecordingBtn.style.display = 'none';
    
    // --- Add new event listener for Upgrade Plan button ---
    document.getElementById('upgradePlanBtn')?.addEventListener('click', showPaymentModal);
}

function initForms() {
    const resumeUploadForm = document.getElementById('resumeUploadForm');
    if (resumeUploadForm) {
        resumeUploadForm.addEventListener('submit', (e) => {
            e.preventDefault();
            uploadResumeAndAnalyze();
        });
    }
}

// --- UI Navigation & State ---

function navigateTo(sectionId) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-target') === sectionId) {
            item.classList.add('active');
        }
    });

    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    const targetElement = document.getElementById(sectionId);
    if (targetElement) {
        targetElement.classList.add('active');
        // Special actions after navigation
        if (sectionId === 'history') {
             loadProgressHistory(); // Load history data when navigating to history tab
        }
         if (sectionId === 'mock-interview' && !state.videoStream) {
            // If navigating to interview and stream isn't setup, prompt for permissions
            // showPermissionsModal(); // This is now triggered by buttons explicitly
        }
    } else {
        console.error(`Navigation target not found: ${sectionId}`);
    }
}

function unlockSection(sectionId) {
    const navItem = document.getElementById(`nav-${sectionId}`);
    if (navItem) {
        const lockIcon = navItem.querySelector('.status-indicator');
        if (lockIcon && lockIcon.classList.contains('locked')) {
            lockIcon.classList.remove('locked');
            lockIcon.classList.add('unlocked');
            lockIcon.innerHTML = '<i class="fas fa-check"></i>';
        }
    }
}

function lockSection(sectionId) {
     const navItem = document.getElementById(`nav-${sectionId}`);
    if (navItem) {
        const lockIcon = navItem.querySelector('.status-indicator');
        if (lockIcon && lockIcon.classList.contains('unlocked')) {
            lockIcon.classList.remove('unlocked');
            lockIcon.classList.add('locked');
            lockIcon.innerHTML = '<i class="fas fa-lock"></i>';
        }
    }
}

function checkForExistingSession() {
    const savedSessionId = localStorage.getItem('irisSessionId');
    if (savedSessionId) {
        console.log(`Found existing session ID: ${savedSessionId}`);
        state.sessionId = savedSessionId;
        checkAnalysisStatus(savedSessionId); // Check if analysis was completed previously
    } else {
        // Lock sections that depend on analysis if no session found
        lockSection('analysis');
        lockSection('prep-plan');
        lockSection('mock-interview');
        lockSection('performance');
        lockSection('history');
    }
}

// --- API Communication ---

// Replace this entire function in app.js
// --- Updated uploadResumeAndAnalyze function ---
function uploadResumeAndAnalyze() {
    // Check feature access first
    if (!checkFeatureAccess('resumeAnalyses')) {
        return;
    }
    
    // Get user authentication data
    const user = firebase.auth().currentUser;
    if (!user) {
        showMessage('Please sign in to use this feature', 'warning');
        if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignInModal === 'function') {
            irisAuth.showSignInModal();
        }
        return;
    }

    const form = document.getElementById('resumeUploadForm');
    if (!form) {
        console.error("resumeUploadForm not found");
        return;
    }
    const formData = new FormData(form);
    const progressContainer = document.getElementById('uploadProgress');
    const progressBar = progressContainer?.querySelector('.progress-bar');
    const progressMessage = document.getElementById('progressMessage');

    if (!progressContainer || !progressBar || !progressMessage) {
        console.error("Progress UI elements not found.");
        return;
    }

    // Basic validation - Check if file exists in FormData
    const resumeFile = formData.get('resumeFile');
    if (!resumeFile || typeof resumeFile === 'string' || resumeFile.size === 0) {
         showMessage("Please select a resume file.", 'warning');
         return;
     }
     if (!formData.get('jobDescription')) {
        showMessage("Please provide a job description.", 'warning');
        return;
    }

    // Add user ID to request
    formData.append('userId', user.uid);
    console.log(`Appending userId: ${user.uid} to FormData`);

    // Reset and show progress bar
    progressContainer.style.display = 'block';
    progressBar.style.width = '10%';
    progressBar.classList.remove('bg-success', 'bg-danger');
    progressMessage.textContent = 'Uploading files...';

    // Disable button during upload
    const analyzeBtn = document.getElementById('analyzeBtn');
    if(analyzeBtn) analyzeBtn.disabled = true; analyzeBtn.textContent = 'Analyzing...';

    fetch(`${API_BASE_URL}/analyze-resume`, {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            // Attempt to read error message from backend JSON response
            return response.json().then(errData => {
                 // Throw an error with the message from backend if available
                 throw new Error(errData.error || `Analysis request failed (${response.status})`);
            }).catch((jsonParseError) => {
                 // If backend didn't send valid JSON error, throw generic HTTP error
                 console.error("Could not parse error JSON from backend:", jsonParseError);
                 throw new Error(`Analysis request failed (${response.status} ${response.statusText})`);
            });
        }
        return response.json();
    })
    .then(data => {
        console.log('Upload response:', data);
        if (!data.sessionId) {
            throw new Error("Backend did not return a valid session ID.");
        }
        
        // Increment usage counter in Firebase
        return irisAuth.incrementUsageCounter('resumeAnalyses')
            .then(usageResult => {
                // Set session ID in the global state (used for polling)
                state.sessionId = data.sessionId;
                console.log("Session ID stored in state. Resume analysis count updated:", usageResult);
                
                // Update usage display
                updateUsageDisplay();
                
                progressMessage.textContent = 'Analyzing resume...';
                pollAnalysisStatus(data.sessionId);
                
                return data; // Pass through the original data
            });
    })
    .catch(error => {
        console.error('Error uploading resume:', error);
        if(progressMessage) progressMessage.textContent = `Error: ${error.message}`;
        if(progressBar) progressBar.classList.add('bg-danger'); progressBar.style.width = '100%';
        showMessage(`Error uploading resume: ${error.message}`, 'danger');

        // Re-enable button on error
        if(analyzeBtn) analyzeBtn.disabled = false; analyzeBtn.textContent = 'Analyze Resume';
    });
}                                                       

function pollAnalysisStatus(sessionId) {
    const progressContainer = document.getElementById('uploadProgress');
    const progressBar = progressContainer?.querySelector('.progress-bar');
    const progressMessage = document.getElementById('progressMessage');

     if (!progressContainer || !progressBar || !progressMessage) return; // Exit if elements aren't there

    const checkStatus = () => {
        // If session changed or cleared, stop polling
        if (state.sessionId !== sessionId) {
            console.log("Session changed, stopping polling for", sessionId);
            return;
        }

        fetch(`${API_BASE_URL}/get-analysis-status/${sessionId}`)
        .then(response => {
            if (response.status === 404) {
                 localStorage.removeItem('irisSessionId'); // Session expired/not found
                 throw new Error('Session not found or expired. Please upload again.');
            }
            if (!response.ok) {
                throw new Error(`Network response was not ok (${response.status})`);
            }
            return response.json();
        })
        .then(statusData => {
            console.log('Status update:', statusData);

            progressBar.style.width = `${statusData.progress || 0}%`;

            if (statusData.status === 'completed') {
                progressMessage.textContent = 'Analysis complete!';
                progressBar.classList.add('bg-success');

                unlockSection('analysis');
                unlockSection('prep-plan');
                unlockSection('mock-interview'); // Unlock interview now

                loadAnalysisResults(sessionId);
                loadPreparationPlan(sessionId);

                setTimeout(() => {
                    navigateTo('analysis');
                    progressContainer.style.display = 'none';
                }, 1500);

            } else if (statusData.status === 'failed') {
                progressMessage.textContent = `Error: ${statusData.errors?.[0] || 'Analysis failed'}`;
                progressBar.classList.add('bg-danger');
                showMessage(`Analysis failed: ${statusData.errors?.[0] || 'Unknown error'}`, 'danger');
            } else { // Still processing
                progressMessage.textContent = `Analyzing resume (${statusData.progress || 0}%)...`;
                // Schedule next poll only if still processing
                 setTimeout(checkStatus, 3000); // Poll slightly less frequently
            }
        })
        .catch(error => {
            console.error('Error checking status:', error);
            progressMessage.textContent = `Error: ${error.message}`;
            progressBar.classList.add('bg-danger');
            showMessage(`Error checking analysis status: ${error.message}`, 'danger');
            if (error.message.includes('Session not found')) {
                 // Reset relevant UI?
            }
        });
    };
    checkStatus(); // Start the first check
}

// Check status of an existing session on page load
function checkAnalysisStatus(sessionId) {
    fetch(`${API_BASE_URL}/get-analysis-status/${sessionId}`)
    .then(response => {
        if (response.status === 404) {
            localStorage.removeItem('irisSessionId');
            state.sessionId = null;
            lockSection('analysis'); // Lock sections again
            lockSection('prep-plan');
            lockSection('mock-interview');
            lockSection('performance');
            lockSection('history');
            return null; // Stop processing
        }
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
    })
    .then(statusData => {
        if (!statusData) return; // Exit if session was not found

        if (statusData.status === 'completed') {
            console.log("Existing session analysis complete. Loading data.");
            unlockSection('analysis');
            unlockSection('prep-plan');
            unlockSection('mock-interview');
            // Check if there's interview history to unlock performance/history
            fetch(`${API_BASE_URL}/get-progress-history/${sessionId}`)
                .then(res => res.ok ? res.json() : null)
                .then(historyData => {
                    if (historyData && historyData.interviews?.length > 0) {
                         unlockSection('performance'); // Unlock based on existing history
                         unlockSection('history');
                    }
                });

            loadAnalysisResults(sessionId);
            loadPreparationPlan(sessionId);
        } else if (statusData.status === 'processing') {
             console.log("Existing session still processing. Restarting polling.");
             // If user reloads page while processing
             document.getElementById('uploadProgress').style.display = 'block'; // Show progress bar again
             pollAnalysisStatus(sessionId);
        } else {
            // Failed or unknown status, treat as needing new upload
             localStorage.removeItem('irisSessionId');
             state.sessionId = null;
        }
    })
    .catch(error => {
        console.error('Error checking existing session status:', error);
        localStorage.removeItem('irisSessionId');
        state.sessionId = null;
    });
}


function loadAnalysisResults(sessionId) {
    fetch(`${API_BASE_URL}/get-full-analysis/${sessionId}`)
    .then(response => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
    })
    .then(data => {
        console.log('Analysis results loaded:', data);
        displayAnalysisResults(data); // Separate display logic
    })
    .catch(error => {
        console.error('Error loading full analysis results:', error);
        document.getElementById('analysis').innerHTML = `<div class="alert alert-danger">Error loading analysis results: ${error.message}</div>`;
    });
}

function loadPreparationPlan(sessionId) {
     fetch(`${API_BASE_URL}/get-full-analysis/${sessionId}`)
    .then(response => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
    })
    .then(data => {
        console.log('Prep plan data loaded:', data);
        displayPreparationPlan(data); // Separate display logic
    })
    .catch(error => {
        console.error('Error loading preparation plan data:', error);
         document.getElementById('prep-plan').innerHTML = `<div class="alert alert-danger">Error loading preparation plan: ${error.message}</div>`;
    });
}

function rewriteResumeSection(section) {
    if (!state.sessionId) {
        alert('No active session. Please analyze a resume first.');
        return;
    }
    console.log(`Requesting rewrite for section: ${section}`);
    // Add a loading indicator?
    const button = document.querySelector(`.rewrite-section-btn[data-section="${section}"]`);
    if(button) button.textContent = 'Rewriting...'; button.disabled = true;

    fetch(`${API_BASE_URL}/rewrite-resume-section`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, section: section })
    })
    .then(response => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
    })
    .then(data => {
        console.log('Rewrite result:', data);
        displayRewriteResult(data, section); // Show result (e.g., in a modal)
    })
    .catch(error => {
        console.error('Error rewriting resume section:', error);
        alert(`Error rewriting section: ${error.message}`);
    })
    .finally(() => {
         if(button) button.textContent = 'Rewrite this section'; button.disabled = false; // Reset button
    });
}

// --- Display Functions ---

// --- Function to modify in app.js ---
// Replace the existing displayAnalysisResults function

function displayAnalysisResults(data) {
    if (!data || !data.matchResults) {
        document.getElementById('analysis').innerHTML = '<div class="alert alert-warning">Analysis data is missing or incomplete.</div>';
        return;
    }
    const matchResults = data.matchResults;

    // Match Score
    const scoreValue = matchResults.matchScore || 0;
    document.getElementById('matchScore').textContent = scoreValue;
    document.querySelector('.match-score-circle')?.style.setProperty('--percentage', `${scoreValue}%`);
    let scoreDesc = "Analysis";
    if (scoreValue >= 80) scoreDesc = "Excellent Match";
    else if (scoreValue >= 60) scoreDesc = "Good Match";
    else if (scoreValue >= 40) scoreDesc = "Fair Match";
    else scoreDesc = "Needs Improvement";
    document.getElementById('matchScoreDescription').textContent = scoreDesc;

    // Match Analysis
    document.getElementById('matchAnalysis').textContent = matchResults.matchAnalysis || 'No analysis summary available.';

    // Key Strengths
    const keyStrengthsList = document.getElementById('keyStrengthsList');
    keyStrengthsList.innerHTML = ''; // Clear loading/previous
    if (matchResults.keyStrengths?.length > 0) {
        matchResults.keyStrengths.forEach(strength => {
            const li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = `<i class="fas fa-check-circle text-success me-2"></i><strong></strong>: `;
            // Safely add text
            li.querySelector('strong').textContent = strength.strength || 'N/A';
            li.appendChild(document.createTextNode(strength.relevance || 'N/A'));
            keyStrengthsList.appendChild(li);
        });
    } else {
        keyStrengthsList.innerHTML = '<li class="list-group-item text-muted">No specific strengths highlighted for this job.</li>';
    }

    // Skill Gaps
    const skillGapsList = document.getElementById('skillGapsList');
    skillGapsList.innerHTML = ''; // Clear loading/previous
    if (matchResults.skillGaps?.length > 0) {
        matchResults.skillGaps.forEach(gap => {
            const li = document.createElement('li');
            li.className = 'list-group-item';
            let importanceIcon = 'fa-exclamation-circle text-warning'; // Medium default
            if (gap.importance?.toLowerCase() === 'high') importanceIcon = 'fa-times-circle text-danger';
            if (gap.importance?.toLowerCase() === 'low') importanceIcon = 'fa-info-circle text-info';
            li.innerHTML = `<i class="fas ${importanceIcon} me-2"></i><strong></strong> (${gap.importance || 'N/A'}): `;
             // Safely add text
            li.querySelector('strong').textContent = gap.missingSkill || 'N/A';
            li.appendChild(document.createTextNode(gap.suggestion || 'N/A'));
            skillGapsList.appendChild(li);
        });
    } else {
        skillGapsList.innerHTML = '<li class="list-group-item text-muted">No critical skill gaps identified.</li>';
    }

    // --- Resume Improvements (Button Removed) ---
    const resumeImprovementsContainer = document.getElementById('resumeImprovements');
    resumeImprovementsContainer.innerHTML = ''; // Clear loading/previous
    if (matchResults.resumeImprovements?.length > 0) {
        const accordion = document.createElement('div');
        accordion.className = 'accordion';
        accordion.id = 'resumeImprovementsAccordion';

        matchResults.resumeImprovements.forEach((improvement, index) => {
            const item = document.createElement('div');
            item.className = 'accordion-item';
            const headerId = `resumeImproveHeader-${index}`;
            const collapseId = `resumeImproveCollapse-${index}`;

            const section = improvement.section || 'General';
            const issue = improvement.issue || 'Suggestion';
            const recommendation = improvement.recommendation || 'N/A';
            const example = improvement.example;

            // Use textContent for safety
            item.innerHTML = `
                <h2 class="accordion-header" id="${headerId}">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
                        <i class="fas fa-edit me-2"></i> Improve: <strong></strong> - <span></span>
                    </button>
                </h2>
                <div id="${collapseId}" class="accordion-collapse collapse" aria-labelledby="${headerId}" data-bs-parent="#resumeImprovementsAccordion">
                    <div class="accordion-body">
                        <p><strong>Recommendation:</strong> <span class="recommendation-text"></span></p>
                        ${example ? `<p><strong>Example:</strong> <em><span class="example-text"></span></em></p>` : ''}
                        </div>
                </div>`;

            // Safely populate text content
            item.querySelector('strong').textContent = section;
            item.querySelector('h2 span').textContent = issue; // Assuming the span after strong is for the issue
            item.querySelector('.recommendation-text').textContent = recommendation;
            if (example) {
                 item.querySelector('.example-text').textContent = example;
            }

            accordion.appendChild(item);
        });
        resumeImprovementsContainer.appendChild(accordion);
        // No need to re-attach event listeners for the removed button
    } else {
        resumeImprovementsContainer.innerHTML = '<div class="alert alert-light">No specific resume improvement suggestions provided for this job.</div>';
    }

    // const analysisSection = document.getElementById('analysis');
    // if(analysisSection && !document.getElementById('resumeResourcesCard')) { // Prevent adding multiple times
    //      const resourceCard = document.createElement('div');
    //      resourceCard.id = 'resumeResourcesCard';
    //      resourceCard.className = 'card mb-4';
    //      resourceCard.innerHTML = `
    //          <div class="card-header"><h3>Resume Resources</h3></div>
    //          <div class="card-body">
    //              <p>Consider these resources for professional resume templates:</p>
    //              <ul>
    //                  <li><a href="https://resumake.io/" target="_blank" rel="noopener noreferrer">Resumake</a></li>
    //                  <li><a href="https://www.canva.com/resumes/templates/" target="_blank" rel="noopener noreferrer">Canva Resume Templates</a></li>
    //                  <li><a href="https://zety.com/resume-templates" target="_blank" rel="noopener noreferrer">Zety Resume Templates</a></li>
    //              </ul>
    //          </div>`;
    //      // Append after resume improvements, before the final button
    //      const nextButton = analysisSection.querySelector('#viewPrepPlanBtn');
    //      if(nextButton) {
    //           nextButton.parentNode.insertBefore(resourceCard, nextButton);
    //      } else {
    //            analysisSection.querySelector('.container').appendChild(resourceCard); // Fallback append
    //      }
    // }


}


// --- Function to modify in app.js ---
// Replace the existing displayPreparationPlan function

// --- Function to modify in app.js ---
// Replace the existing displayPreparationPlan function

function displayPreparationPlan(data) {
    if (!data || !data.prepPlan) {
        document.getElementById('prep-plan').innerHTML = '<div class="alert alert-warning">Preparation plan data is missing or incomplete.</div>';
        return;
    }
    const prepPlan = data.prepPlan;

    // --- Focus Areas --- (Keep as before)
    const focusAreasList = document.getElementById('focusAreasList');
    if (focusAreasList) {
        focusAreasList.innerHTML = '';
        if (prepPlan.focusAreas?.length > 0) {
            prepPlan.focusAreas.forEach(area => {
                const li = document.createElement('li');
                li.innerHTML = `<i class="fas fa-bullseye me-2"></i>`;
                li.appendChild(document.createTextNode(area || 'N/A')); // Handle potential null/undefined
                focusAreasList.appendChild(li);
            });
        } else {
            focusAreasList.innerHTML = '<li class="text-muted">No specific focus areas provided.</li>';
        }
    }

    // --- Likely Questions (Updated) --- (Keep as before)
    const likelyQuestionsContainer = document.getElementById('likelyQuestions');
    if (likelyQuestionsContainer) {
        likelyQuestionsContainer.innerHTML = ''; // Clear previous
        if (prepPlan.likelyQuestions?.length > 0) {
            const accordion = document.createElement('div');
            accordion.className = 'accordion';
            accordion.id = 'likelyQuestionsAccordion';
            prepPlan.likelyQuestions.forEach((item, index) => {
                const accordionItem = document.createElement('div');
                accordionItem.className = 'accordion-item';
                const headerId = `qHeader-${index}`;
                const collapseId = `qCollapse-${index}`;

                const category = item.category || "General";
                const question = item.question || "No question text.";
                const guidance = item.guidance || "No specific guidance provided.";

                // Create button and content safely
                const button = document.createElement('button');
                button.className = 'accordion-button collapsed';
                button.type = 'button';
                button.dataset.bsToggle = 'collapse';
                button.dataset.bsTarget = `#${collapseId}`;
                button.setAttribute('aria-expanded', 'false');
                button.setAttribute('aria-controls', collapseId);
                button.innerHTML = `<span class="badge bg-secondary me-2"></span> `; // Placeholder for category
                button.querySelector('.badge').textContent = category; // Set category safely
                button.appendChild(document.createTextNode(question)); // Set question safely

                const header = document.createElement('h2');
                header.className = 'accordion-header';
                header.id = headerId;
                header.appendChild(button);

                const collapseDiv = document.createElement('div');
                collapseDiv.id = collapseId;
                collapseDiv.className = 'accordion-collapse collapse';
                collapseDiv.setAttribute('aria-labelledby', headerId);
                collapseDiv.dataset.bsParent = '#likelyQuestionsAccordion';

                const bodyDiv = document.createElement('div');
                bodyDiv.className = 'accordion-body';
                bodyDiv.innerHTML = `<strong><i class="fas fa-info-circle me-1"></i>Guidance:</strong>`;
                const guidanceP = document.createElement('p');
                guidanceP.textContent = guidance; // Set guidance safely
                bodyDiv.appendChild(guidanceP);
                collapseDiv.appendChild(bodyDiv);

                accordionItem.appendChild(header);
                accordionItem.appendChild(collapseDiv);
                accordion.appendChild(accordionItem);
            });
            likelyQuestionsContainer.appendChild(accordion);
        } else {
            likelyQuestionsContainer.innerHTML = '<div class="alert alert-light">No likely questions generated for this plan.</div>';
        }
    }

    // --- Concepts to Study --- (Keep as before)
    const conceptsToStudyContainer = document.getElementById('conceptsToStudy');
    if (conceptsToStudyContainer) {
        conceptsToStudyContainer.innerHTML = ''; // Clear
        if (prepPlan.conceptsToStudy) {
            const conceptsContent = formatConcepts(prepPlan.conceptsToStudy); // Use existing helper
            if (conceptsContent) {
                conceptsToStudyContainer.appendChild(conceptsContent);
            } else {
                conceptsToStudyContainer.innerHTML = '<div class="alert alert-light">No specific concepts to study listed.</div>';
            }
        } else {
            conceptsToStudyContainer.innerHTML = '<div class="alert alert-light">No specific concepts to study listed.</div>';
        }
    }

    // --- Gap Strategies Section --- (Keep as before)
     const gapStrategiesContainer = document.getElementById('gapStrategies');
     if (gapStrategiesContainer) {
        gapStrategiesContainer.innerHTML = ''; // Clear loading/previous
        if (prepPlan.gapStrategies?.length > 0) {
            const listGroup = document.createElement('div');
            listGroup.className = 'list-group list-group-flush'; // Flush looks good inside card
            prepPlan.gapStrategies.forEach(item => {
                const listItem = document.createElement('div');
                listItem.className = 'list-group-item';
                // Use textContent for safety where possible
                listItem.innerHTML = `<h6 class="mb-1"><i class="fas fa-exclamation-triangle text-warning me-2"></i> Gap: <span class="gap-text"></span></h6>`;
                listItem.querySelector('.gap-text').textContent = item.gap || 'N/A';

                const strategyP = document.createElement('p');
                strategyP.className = 'mb-1';
                strategyP.innerHTML = `<strong><i class="fas fa-comments me-1"></i> Suggested Strategy:</strong> `;
                strategyP.appendChild(document.createTextNode(item.strategy || 'No specific strategy provided.'));
                listItem.appendChild(strategyP);

                const focusSmall = document.createElement('small');
                focusSmall.className = 'text-muted';
                focusSmall.innerHTML = `<strong><i class="fas fa-book-open me-1"></i> Focus for Prep:</strong> `;
                focusSmall.appendChild(document.createTextNode(item.focus_during_prep || 'Review related concepts.'));
                listItem.appendChild(focusSmall);

                listGroup.appendChild(listItem);
            });
             gapStrategiesContainer.appendChild(listGroup);
        } else {
             gapStrategiesContainer.innerHTML = '<div class="alert alert-light">No specific gap strategies provided.</div>';
        }
    }


    // --- REMOVE Old Timeline Display Logic ---
    const preparationTimelineContainer = document.getElementById('preparationTimeline');
    if (preparationTimelineContainer) {
        // Clear the container instead of populating it
        preparationTimelineContainer.innerHTML = ''; // Remove old content
        // Maybe hide the parent card if it's now empty, or add placeholder text for dynamic one
        const parentCard = preparationTimelineContainer.closest('.card');
        if (parentCard) parentCard.style.display = 'none'; // Hide the old timeline card entirely
    }

    // --- Make Dynamic Timeline Controls Visible ---
    const dynamicTimelineControls = document.getElementById('dynamicTimelineControls');
    if (dynamicTimelineControls) {
        dynamicTimelineControls.style.display = 'block'; // Show the input and button

        // Ensure listener is attached only once or re-attach if needed
        const generateBtn = document.getElementById('generateDynamicTimelineBtn');

        // Clone and replace to remove old listeners before adding a new one
        if (generateBtn) {
            const newBtn = generateBtn.cloneNode(true);
            generateBtn.parentNode.replaceChild(newBtn, generateBtn);
            newBtn.addEventListener('click', handleGenerateDynamicTimeline);
            console.log("Event listener attached to generateDynamicTimelineBtn");
        }

    } else {
        console.error("Dynamic timeline controls container not found!");
    }

}

// --- Add NEW Handler function ---
function handleGenerateDynamicTimeline() {
    const daysInput = document.getElementById('daysUntilInterview');
    const dynamicTimelineArea = document.getElementById('dynamicTimelineArea');
    const generateBtn = document.getElementById('generateDynamicTimelineBtn'); // Get button ref again

    if (!daysInput || !dynamicTimelineArea || !generateBtn) {
        console.error("Timeline input/area/button elements not found.");
        return;
    }

    const days = daysInput.value.trim();
    if (!days || isNaN(parseInt(days)) || parseInt(days) <= 0 || parseInt(days) > 90) {
         alert("Please enter a valid number of days (1-90).");
         daysInput.focus(); // Focus the input for correction
         return;
    }

    if (!state.sessionId) {
        alert("No active session found. Please analyze resume first.");
        return;
    }

    console.log(`Requesting dynamic timeline for ${days} days, session ${state.sessionId}`);

    // Show loading state
    dynamicTimelineArea.innerHTML = `
        <div class="text-center p-3">
             <div class="spinner-border text-primary" role="status">
                 <span class="visually-hidden">Loading...</span>
             </div>
             <p class="mt-2">Generating your personalized timeline (this may take a moment)...</p>
         </div>`;
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Generating...'; // Add spinner to button

    // Call the new backend endpoint
    fetch(`${API_BASE_URL}/generate-dynamic-timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: state.sessionId,
            days: days
        })
    })
    .then(response => {
        if (!response.ok) {
            // Try to get error from JSON body
             return response.json().then(errData => {
                 // Use the specific error from backend if available
                 throw new Error(errData.error || `Timeline generation failed (${response.status})`);
            }).catch(() => {
                 // Fallback if response wasn't JSON
                 throw new Error(`Timeline generation failed (${response.status})`);
             });
        }
        return response.json();
    })
    .then(data => {
        console.log("Dynamic timeline data received:", data);
        displayDynamicTimeline(data); // Display the result
    })
    .catch(error => {
        console.error("Error generating dynamic timeline:", error);
        dynamicTimelineArea.innerHTML = `<div class="alert alert-danger">Error generating timeline: ${error.message}</div>`;
    })
    .finally(() => {
         // Restore button state
         generateBtn.disabled = false;
         generateBtn.textContent = 'Generate Dynamic Timeline'; // Restore original text
    });
}

// --- Add NEW Display function ---
function displayDynamicTimeline(data) {
    const dynamicTimelineArea = document.getElementById('dynamicTimelineArea');
    if (!dynamicTimelineArea) return;
    dynamicTimelineArea.innerHTML = ''; // Clear loading/previous

    if (data.error) {
         dynamicTimelineArea.innerHTML = `<div class="alert alert-warning">Could not generate timeline: ${data.error}</div>`;
         return;
    }

    if (!data || !data.timeline || data.timeline.length === 0) {
        dynamicTimelineArea.innerHTML = '<div class="alert alert-light">No timeline schedule was generated. Please try again or adjust the number of days.</div>';
        return;
    }

    const timelineContainer = document.createElement('div');
    timelineContainer.className = 'dynamic-timeline mt-3'; // Add a class for styling

    data.timeline.forEach(dayEntry => {
        const dayCard = document.createElement('div');
        // Add alternating background for readability if desired
        dayCard.className = 'card timeline-day-card mb-3';

        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header d-flex justify-content-between align-items-center p-2'; // Reduced padding
        // Use textContent for safety
        cardHeader.innerHTML = `<h5 class="mb-0 day-header"></h5> <span class="badge bg-info focus-badge"></span>`;
        cardHeader.querySelector('.day-header').textContent = `Day ${dayEntry.day}`;
        cardHeader.querySelector('.focus-badge').textContent = dayEntry.focus || 'General Prep';


        const cardBody = document.createElement('div');
        cardBody.className = 'card-body p-2'; // Reduced padding

        const scheduleList = document.createElement('ul');
        scheduleList.className = 'list-group list-group-flush schedule-list';

        if (dayEntry.schedule && dayEntry.schedule.length > 0) {
            dayEntry.schedule.forEach(item => {
                const listItem = document.createElement('li');
                listItem.className = 'list-group-item schedule-item py-1 px-0'; // Reduced padding
                // Use textContent for safety
                listItem.innerHTML = `${item.time_slot ? `<span class="time-slot"></span> ` : ''}<span class="task-description"></span>`;
                if(item.time_slot) listItem.querySelector('.time-slot').textContent = `${item.time_slot}:`;
                listItem.querySelector('.task-description').textContent = item.task || 'N/A';
                scheduleList.appendChild(listItem);
            });
        } else {
            scheduleList.innerHTML = '<li class="list-group-item text-muted py-1 px-0">No specific tasks scheduled. Focus on the day\'s theme.</li>';
        }

        cardBody.appendChild(scheduleList);

        if (dayEntry.notes) {
            const notesP = document.createElement('p');
            notesP.className = 'mt-2 mb-0 text-muted small fst-italic notes-text'; // Use class for styling
            notesP.innerHTML = `<i class="far fa-sticky-note me-1"></i> `;
            notesP.appendChild(document.createTextNode(dayEntry.notes)); // Safe text
            cardBody.appendChild(notesP);
        }

        dayCard.appendChild(cardHeader);
        dayCard.appendChild(cardBody);
        timelineContainer.appendChild(dayCard);
    });

    if (data.estimated_total_hours) {
        const estimateP = document.createElement('p');
        estimateP.className = 'text-center text-muted mt-3 total-hours';
        estimateP.textContent = `Estimated Total Preparation Time: ~${data.estimated_total_hours} hours`;
        timelineContainer.appendChild(estimateP);
    }

    dynamicTimelineArea.appendChild(timelineContainer);
}


function displayRewriteResult(rewriteData, section) {
    // Example: Show in a modal (requires a modal structure in index.html)
    /*
    const modalTitle = document.getElementById('rewriteModalLabel');
    const modalBody = document.getElementById('rewriteModalBody');
    if (modalTitle && modalBody) {
        modalTitle.textContent = `AI Rewrite Suggestion for: ${section}`;
        modalBody.innerHTML = `
            <h5>Original:</h5>
            <pre><code>${rewriteData.original || '[Not Available]'}</code></pre>
            <hr>
            <h5>Suggested Improvement:</h5>
            <pre><code>${rewriteData.improved || '[Not Available]'}</code></pre>
            <hr>
            <h5>Rationale:</h5>
            <ul>
                ${rewriteData.explanations?.map(ex => `<li><strong>${ex.change || ''}:</strong> ${ex.rationale || ''}</li>`).join('') || '<li>No specific rationale provided.</li>'}
            </ul>
        `;
        const rewriteModal = new bootstrap.Modal(document.getElementById('rewriteModal'));
        rewriteModal.show();
    } else { // Fallback to alert
        alert(`Rewritten ${section}:\n\n${rewriteData.improved}\n\nRationale: ${rewriteData.explanations?.[0]?.rationale || 'N/A'}`);
    }
    */
     // Simple alert for now
    alert(`AI Suggestion for ${section}:\n\n${rewriteData.improved}\n\nRationale: ${rewriteData.explanations?.[0]?.rationale || 'N/A'}`);

}

// Helper to format concepts (handles object or array)
function formatConcepts(concepts) {
    const container = document.createElement('div');
    if (Array.isArray(concepts) && concepts.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'list-group list-group-flush';
        concepts.forEach(concept => {
            const li = document.createElement('li');
            li.className = 'list-group-item';
             li.innerHTML = `<i class="fas fa-lightbulb me-2"></i>${concept}`;
            ul.appendChild(li);
        });
        container.appendChild(ul);
        return container;
    } else if (typeof concepts === 'object' && concepts !== null && Object.keys(concepts).length > 0) {
        for (const category in concepts) {
            const catDiv = document.createElement('div');
            catDiv.className = 'mb-3';
            catDiv.innerHTML = `<h6>${category}</h6>`;
            const subList = document.createElement('ul');
            subList.className = 'list-group list-group-flush';
            const items = Array.isArray(concepts[category]) ? concepts[category] : [concepts[category]];
            items.forEach(item => {
                 const li = document.createElement('li');
                 li.className = 'list-group-item';
                 li.innerHTML = `<i class="fas fa-lightbulb me-2"></i>${item}`;
                 subList.appendChild(li);
            });
            catDiv.appendChild(subList);
            container.appendChild(catDiv);
        }
        return container;
    }
    return null; // No valid concepts found
}


// Helper to format timeline (handles object or array)
function formatTimeline(timelineData) {
    const container = document.createElement('div');
    container.className = 'timeline'; // Add base class for potential styling

     if (Array.isArray(timelineData) && timelineData.length > 0) {
         timelineData.forEach(item => {
             const timelineItem = document.createElement('div');
             timelineItem.className = 'timeline-item'; // Use classes from styles.css
             const timelineContent = document.createElement('div');
             timelineContent.className = 'timeline-content';

             if (typeof item === 'string') {
                timelineContent.innerHTML = `<i class="far fa-clock me-2"></i>${item}`;
             } else if (typeof item === 'object' && item !== null) {
                 // Assuming structure like { period: "...", tasks: ["..."] } or similar
                 const title = item.period || item.title || Object.keys(item)[0];
                 const content = item.tasks || item.details || item[title];
                 timelineContent.innerHTML = `<div class="timeline-header"><i class="far fa-calendar-alt me-2"></i>${title}</div>`;
                 if (Array.isArray(content)) {
                     const ul = document.createElement('ul');
                     content.forEach(task => ul.innerHTML += `<li>${task}</li>`);
                     timelineContent.appendChild(ul);
                 } else {
                      timelineContent.innerHTML += `<p>${content}</p>`;
                 }
             }
             timelineItem.appendChild(timelineContent);
             container.appendChild(timelineItem);
         });
        return container;
    } else if (typeof timelineData === 'object' && timelineData !== null && Object.keys(timelineData).length > 0) {
        for (const period in timelineData) {
            const timelineItem = document.createElement('div');
            timelineItem.className = 'timeline-item';
            const timelineContent = document.createElement('div');
            timelineContent.className = 'timeline-content';
            timelineContent.innerHTML = `<div class="timeline-header"><i class="far fa-calendar-alt me-2"></i>${period}</div>`;
             const activities = timelineData[period];
            if (Array.isArray(activities)) {
                const ul = document.createElement('ul');
                activities.forEach(activity => ul.innerHTML += `<li>${activity}</li>`);
                timelineContent.appendChild(ul);
            } else {
                timelineContent.innerHTML += `<p>${activities}</p>`;
            }
             timelineItem.appendChild(timelineContent);
            container.appendChild(timelineItem);
        }
        return container;
    }
    return null; // No valid timeline data
}

// --- Mock Interview Functions ---

function showPermissionsModal() {
    const modalElement = document.getElementById('permissionsModal');
    if(modalElement) {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    } else {
        console.warn("Permissions modal not found. Attempting to get media directly.");
        // Fallback: try getting media directly, browser will prompt
        setupMediaDevices();
    }
}

function setupMediaDevices() {
    // Close the permissions modal if it exists and is shown
    const modalElement = document.getElementById('permissionsModal');
     if(modalElement) {
        const modalInstance = bootstrap.Modal.getInstance(modalElement);
        modalInstance?.hide();
    }

    console.log("Requesting media permissions...");
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            console.log("Media permissions granted.");
            state.videoStream = stream;

            const videoElement = document.getElementById('candidateVideo');
            if (videoElement) {
                videoElement.srcObject = stream;
                videoElement.play().catch(e => console.error("Video play error:", e)); // Handle autoplay restrictions
            }

            setupMediaRecorder(stream);

            // Only start the interview *after* media is set up
            startMockInterview();
        })
        .catch(error => {
            console.error('Error accessing media devices:', error);
            alert(`Could not access camera/microphone: ${error.message}\n\nPlease grant permissions and ensure no other app is using the devices.`);
            // Optionally navigate away from interview section or show error state
            navigateTo('prep-plan'); // Go back to prep plan
        });
}

function setupMediaRecorder(stream) {
    if (typeof MediaRecorder === 'undefined') {
        console.error("MediaRecorder is not supported in this browser.");
        alert("Voice input is not supported in your browser.");
        return; // Cannot proceed with recording
    }

    // --- Web Audio API Setup for VAD ---
    try {
        state.audioContext = state.audioContext || new (window.AudioContext || window.webkitAudioContext)();
        if (state.audioSourceNode) state.audioSourceNode.disconnect();
        if (state.analyserNode) state.analyserNode.disconnect();

        state.analyserNode = state.audioContext.createAnalyser();
        state.analyserNode.fftSize = FFT_SIZE;
        const bufferLength = state.analyserNode.frequencyBinCount;
        state.audioDataArray = new Uint8Array(bufferLength);
        console.log("VAD Analyser buffer length:", bufferLength);

        const audioTracks = stream.getAudioTracks();
        if (!audioTracks.length) throw new Error("No audio track found in stream for analysis.");
        state.audioSourceNode = state.audioContext.createMediaStreamSource(stream);
        state.audioSourceNode.connect(state.analyserNode);
        console.log("Web Audio API VAD setup complete.");
    } catch (e) {
        console.error("Failed to set up Web Audio API for VAD:", e);
        alert(`Failed to initialize audio analysis: ${e.message}. Voice detection may be less accurate.`);
        state.audioContext = null;
        state.analyserNode = null;
        state.audioSourceNode = null;
        state.audioDataArray = null;
    }
    // --- End Web Audio API Setup ---


    // --- MediaRecorder Setup (using audio-only stream) ---
    const audioTracksForRecorder = stream.getAudioTracks();
    if (!audioTracksForRecorder.length) {
        console.error("No audio track found for MediaRecorder.");
        alert("Could not find microphone track for recording.");
        return;
    }
    const audioStreamForRecorder = new MediaStream([audioTracksForRecorder[0]]);

    let options = { mimeType: 'audio/webm;codecs=opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        console.warn(`${options.mimeType} not supported, trying audio/ogg`);
        options = { mimeType: 'audio/ogg;codecs=opus' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.warn(`${options.mimeType} not supported, trying audio/webm (default)`);
            options = { mimeType: 'audio/webm' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn(`${options.mimeType} not supported, using browser default`);
                options = {};
            }
        }
    }
    console.log("Using MediaRecorder options:", options);

    try {
        state.mediaRecorder = new MediaRecorder(audioStreamForRecorder, options);

        state.mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                state.audioChunks.push(event.data);
            } else {
                // console.log("Received empty audio chunk."); // Can be noisy
            }
        };

        // **** MODIFIED onstop handler ****
        state.mediaRecorder.onstop = () => {
            console.log("MediaRecorder stopped.");
            // --- Check speech *before* resetting flag ---
            const speechWasDetectedInThisSegment = state.speechDetectedInChunk;
            const currentAudioChunks = [...state.audioChunks]; // Copy chunks before clearing
            state.audioChunks = []; // Clear chunks immediately after stopping

            // --- Reset flag AFTER checking ---
            state.speechDetectedInChunk = false;

            // --- Make decision based on the check ---
            if (!speechWasDetectedInThisSegment || currentAudioChunks.length === 0) {
                console.warn(`No speech detected in last segment (flag=${speechWasDetectedInThisSegment}) or no audio data captured. Discarding.`);

                // Restart listening if the interview is still active and AI isn't talking
                if (state.isInterviewActive && !state.isAIResponding) {
                     console.log("No valid speech detected, restarting listening.");
                     setTimeout(() => {
                        if (state.isInterviewActive && !state.isAIResponding) {
                             startListeningAutomatically();
                        }
                     }, 500); // Small delay
                }
                return; // Don't process the empty/silent audio
            }

            // --- Process valid audio ---
            console.log(`Speech detected (flag=${speechWasDetectedInThisSegment}), processing ${currentAudioChunks.length} audio chunks.`);
            const mimeType = state.mediaRecorder.mimeType || options.mimeType || 'audio/webm';
            const audioBlob = new Blob(currentAudioChunks, { type: mimeType });

            processAudioResponse(audioBlob, mimeType); // Pass mimeType
        };
        // **** END MODIFIED onstop handler ****


        state.mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
            alert(`Recording error: ${event.error.name} - ${event.error.message}`);
            state.isRecording = false;
            clearTimeout(state.silenceTimer);
            cancelAnimationFrame(state.vadAnimationFrameId);
            clearInterval(state.recordingTimer);
            state.speechDetectedInChunk = false; // Reset on error
            state.audioChunks = []; // Clear chunks on error
        };

        console.log("MediaRecorder setup complete.");

    } catch (e) {
        console.error("Failed to create MediaRecorder:", e);
        alert(`Failed to initialize audio recorder: ${e.message}`);
    }
}


// --- Updated startMockInterview function ---
function startMockInterview() {
    // Check feature access first
    if (!checkFeatureAccess('mockInterviews')) {
        return;
    }

    if (!state.sessionId) {
        alert('No active session. Please analyze a resume first.');
        navigateTo('upload');
        return;
    }
    
    if (!state.mediaRecorder) {
        alert('Audio recorder not initialized. Please grant microphone permissions.');
        showPermissionsModal();
        return;
    }

    console.log(`Starting ${state.interviewType} interview for session: ${state.sessionId}`);
    state.isInterviewActive = true;
    state.isAIResponding = false;
    state.conversationHistory = [];

    const conversationContainer = document.getElementById('conversationContainer');
    if(conversationContainer) conversationContainer.innerHTML = '';

    addMessageToConversation("system", `Starting ${state.interviewType} interview...`);

    fetch(`${API_BASE_URL}/start-mock-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: state.sessionId,
            interviewType: state.interviewType
        })
    })
    .then(response => {
        if (!response.ok) throw new Error(`Network response was not ok (${response.status})`);
        return response.json();
    })
    .then(data => {
        console.log('Interview started response:', data);
        if (!data.interviewId || !data.greeting) {
            throw new Error("Invalid response from start-mock-interview");
        }
        
        // Increment usage counter in Firebase
        return irisAuth.incrementUsageCounter('mockInterviews')
            .then(usageResult => {
                state.interviewId = data.interviewId;
                
                // Update usage display
                updateUsageDisplay();
                
                // Remove "Starting..." message
                const systemMessages = conversationContainer.querySelectorAll('.message.system');
                systemMessages.forEach(msg => msg.remove());
                
                // Display and speak greeting
                addMessageToConversation('interviewer', data.greeting);
                generateAndPlayTTS(data.greeting);
                
                return data;
            });
    })
    .catch(error => {
        console.error('Error starting interview:', error);
        alert(`Error starting interview: ${error.message}`);
        state.isInterviewActive = false;
        addMessageToConversation("system", `Error starting interview: ${error.message}. Please try again.`);
    });
}

function sendTextReply() {
    const userReplyInput = document.getElementById('userReplyInput');
    if (!userReplyInput) return;
    const userResponse = userReplyInput.value.trim();

    if (!userResponse) return;
    if (!state.isInterviewActive || !state.interviewId) {
         alert("Interview is not active.");
         return;
    }
     if (state.isAIResponding || state.isRecording) {
        console.warn("Cannot send text reply while AI is responding or recording is active.");
        return; // Prevent sending while AI talks or mic is busy
    }


    console.log("Sending text reply:", userResponse);
    userReplyInput.value = ''; // Clear input

    addMessageToConversation('candidate', userResponse);
    sendUserResponseToBackend(userResponse);
}

// --- Continuous Voice Logic ---

function startListeningAutomatically() {
    // Don't listen if interview ended, or if AI is currently speaking/processing
    if (!state.isInterviewActive || state.isAIResponding) {
        console.log("Skipping automatic listening (interview not active or AI responding).");
        return;
    }
    if (state.isRecording) {
        console.log("Already recording, skipping automatic start.");
        return; // Already recording
    }
    if (!state.mediaRecorder || !state.analyserNode || !state.audioDataArray) { // Check VAD components too
        console.error("MediaRecorder or VAD components not available to start listening.");
        // Attempt to re-setup or prompt user?
        // showPermissionsModal(); // Could prompt again
        return;
    }
    if (state.mediaRecorder.state !== 'inactive') {
        console.warn(`MediaRecorder not inactive (${state.mediaRecorder.state}), attempting recovery...`);
        // Try stopping previous recording forcefully? Risky. Best to prevent this state.
        try {
             state.mediaRecorder.stop(); // Attempt to stop
        } catch(e) { console.error("Error stopping stuck recorder:", e); }
        // Clear state and potentially try again after a short delay
        state.isRecording = false;
        clearTimeout(state.silenceTimer);
        cancelAnimationFrame(state.vadAnimationFrameId);
        state.speechDetectedInChunk = false;
        setTimeout(startListeningAutomatically, 200); // Retry shortly
        return;
    }

    console.log("AI finished speaking, starting automatic recording...");
    const micIcon = document.getElementById('toggleMicBtn')?.querySelector('i');

    state.audioChunks = []; // Clear previous chunks
    state.isRecording = true;
    state.recordingStartTime = Date.now();
    state.speechDetectedInChunk = false; // Reset speech detection flag for this new chunk
    clearTimeout(state.silenceTimer); // Ensure any old silence timer is cleared

    try {
        state.mediaRecorder.start(); // Start recorder (records continuously until stopped)
        console.log("MediaRecorder started for automatic listening.");
        if(micIcon) micIcon.classList.remove('fa-microphone-slash'); // Ensure visual state is correct
        if(micIcon) micIcon.classList.add('fa-microphone-alt', 'text-danger'); // Indicate listening

        // Start the VAD loop
        checkAudioLevel(); // Begin checking audio levels

    } catch (e) {
        console.error("Error starting MediaRecorder:", e);
        alert(`Error starting recording: ${e.message}`);
        state.isRecording = false;
        if(micIcon) micIcon.classList.remove('fa-microphone-alt', 'text-danger');
    }
}

// function startSilenceDetection() {
//     clearTimeout(state.silenceTimer); // Clear previous timer

//     console.log(`Starting silence timer (${state.silenceDelay}ms)...`);

//     // !! IMPORTANT !!
//     // This is a placeholder using only a timer. Real VAD requires analyzing
//     // the audio stream with the Web Audio API (AnalyserNode) to detect actual
//     // silence and reset this timer when speech is detected.
//     // This basic timer will stop recording after state.silenceDelay ms
//     // regardless of whether the user was actually silent.
//     state.silenceTimer = setTimeout(() => {
//         console.log("Silence timer expired.");
//         if (state.isRecording) {
//             stopRecordingAndProcess();
//         } else {
//              console.log("Silence timer expired, but not recording.");
//         }
//     }, state.silenceDelay);

//     // --- Placeholder for real VAD ---
//     // In a real implementation, you would:
//     // 1. Use Web Audio API AnalyserNode to get volume levels periodically.
//     // 2. If volume > threshold (speech): clearTimeout(state.silenceTimer); startSilenceDetection(); // Reset timer
//     // 3. If volume < threshold (silence): Let the timer run.
//     // ---------------------------------
// }

// --- VAD Core Logic ---
// --- VAD Core Logic (with Volume Logging) ---
function checkAudioLevel() {
    // Stop the loop if no longer recording or VAD components missing
    if (!state.isRecording || !state.analyserNode || !state.audioDataArray) {
        // console.log("Stopping VAD loop (not recording or VAD missing)."); // Can be noisy
        // Make sure animation frame is cancelled if VAD components are missing mid-recording
        if(state.vadAnimationFrameId) {
            cancelAnimationFrame(state.vadAnimationFrameId);
            state.vadAnimationFrameId = null;
        }
        return;
    }

    // Schedule the next check
    state.vadAnimationFrameId = requestAnimationFrame(checkAudioLevel);

    // Get audio data
    try {
        state.analyserNode.getByteFrequencyData(state.audioDataArray); // Fill the array
    } catch (e) {
         console.error("Error getting frequency data from AnalyserNode:", e);
         // Stop VAD if analyser fails
         state.isRecording = false; // Mark as not recording to prevent recorder issues
         cancelAnimationFrame(state.vadAnimationFrameId);
         state.vadAnimationFrameId = null;
         // Optionally, try to stop the recorder gracefully
         // stopRecordingAndProcess(); // Might lead to unexpected states if called from here
         return;
    }


    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < state.audioDataArray.length; i++) {
        sum += state.audioDataArray[i];
    }
    const averageVolume = sum / state.audioDataArray.length;

    // **** ADDED LOGGING ****
    // Log volume periodically (e.g., every ~30 frames) to avoid flooding console
    if (!window.vadLogCounter) window.vadLogCounter = 0;
    window.vadLogCounter++;
    if (window.vadLogCounter % 30 === 0) {
        console.log(`VAD Avg Vol: ${averageVolume.toFixed(2)} (Threshold: ${SPEECH_THRESHOLD})`);
    }
    // ***********************


    // --- Silence Detection Logic ---
    if (averageVolume > SPEECH_THRESHOLD) {
        // Speech detected
        if (!state.speechDetectedInChunk) {
             console.log(`--- Speech Detected (Volume: ${averageVolume.toFixed(2)}) ---`); // Log first detection
             state.speechDetectedInChunk = true; // Mark that speech has occurred
        }
        // If silence timer is running, clear it because speech is happening again
        if (state.silenceTimer) {
            // console.log("Speech detected, clearing silence timer."); // Can be noisy
            clearTimeout(state.silenceTimer);
            state.silenceTimer = null;
        }
    } else {
        // Silence detected (or below threshold)
        // Start the silence timer ONLY if speech has already been detected in this chunk
        // AND the timer isn't already running.
        if (state.speechDetectedInChunk && !state.silenceTimer) {
             console.log(`Silence detected after speech (Volume: ${averageVolume.toFixed(2)}), starting ${state.silenceDelay}ms timeout...`);
             state.silenceTimer = setTimeout(() => {
                 console.log("Silence timer expired after speech.");
                 // Double check we are still recording before stopping
                 if (state.isRecording) {
                     stopRecordingAndProcess();
                 } else {
                      console.log("Silence timer expired, but recording already stopped.");
                      state.silenceTimer = null; // Clear timer ID
                 }
             }, state.silenceDelay);
        }
        // If silence timer IS running, do nothing - let it expire or be cleared by speech.
    }
}

function stopRecordingAndProcess() {
    if (!state.isRecording && state.mediaRecorder?.state !== 'recording') {
         // console.log("Stop recording called, but not currently recording."); // Can be noisy
         return; // Already stopped or wasn't started
    }
    console.log("Stopping recording and VAD...");
    const micIcon = document.getElementById('toggleMicBtn')?.querySelector('i');

    const wasRecording = state.isRecording; // Store if we were actively recording
    state.isRecording = false; // Mark as not recording

    // Stop the VAD loop FIRST
    if (state.vadAnimationFrameId) {
        cancelAnimationFrame(state.vadAnimationFrameId);
        state.vadAnimationFrameId = null;
        console.log("VAD Animation Frame cancelled.");
    }

    // Clear any pending silence timer
    if (state.silenceTimer) {
        clearTimeout(state.silenceTimer);
        state.silenceTimer = null;
        console.log("Pending silence timer cleared.");
    }

    // Stop visual timer
    clearInterval(state.recordingTimer);

    // --- REMOVED state.speechDetectedInChunk = false; from here ---

    // Stop the MediaRecorder - this is asynchronous and triggers 'onstop'
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
        console.log("Calling mediaRecorder.stop()");
        try {
             state.mediaRecorder.stop(); // Triggers 'onstop' which handles blob processing
        } catch(e) {
             console.error("Error stopping media recorder:", e);
             state.audioChunks = []; // Clear chunks on error
             state.speechDetectedInChunk = false; // Reset flag on error too
        }
    } else {
        console.warn(`Attempted to stop recording, but recorder state was: ${state.mediaRecorder?.state}.`);
        // If recorder wasn't 'recording' but we thought we were, reset UI and potentially clear chunks
         state.audioChunks = [];
         state.speechDetectedInChunk = false; // Reset flag if recorder was not in correct state
    }

    // Reset mic icon
    if(micIcon) micIcon.classList.remove('fa-microphone-alt', 'text-danger');

    // IMPORTANT: The actual processing now happens in the 'onstop' event handler
    console.log(`stopRecordingAndProcess finished.`); // Removed speech detected log here as it's checked in onstop
}

function processAudioResponse(audioBlob, mimeType = 'audio/webm') {
     console.log(`Processing recorded audio blob. Size: ${audioBlob.size}, Type: ${mimeType}`);
     // document.getElementById('processingIndicator').style.display = 'none'; // Hide processing indicator

    if (!state.interviewId) {
        console.error("No active interview ID to process audio for.");
        return;
    }
     if (audioBlob.size < 100) { // Very small blob might be noise/error
        console.warn("Audio blob size is very small, skipping processing.");
         // Restart listening?
         if(state.isInterviewActive && !state.isAIResponding) {
             startListeningAutomatically();
         }
        return;
    }


    const formData = new FormData();
    // Use the determined mimeType for the filename extension if possible
    const fileExtension = mimeType.split('/')[1]?.split(';')[0] || 'webm';
    const filename = `recording.${fileExtension}`;
    formData.append('audio', audioBlob, filename);
    formData.append('interviewId', state.interviewId);

    console.log(`Sending audio to /process-audio as ${filename}`);
    state.isAIResponding = true; // Mark AI as busy while processing audio/getting response

    fetch(`${API_BASE_URL}/process-audio`, {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
        return response.json();
    })
    .then(data => {
        console.log('Transcription result:', data);
        if (data.transcription && data.transcription.trim()) {
            addMessageToConversation('candidate', data.transcription);
            sendUserResponseToBackend(data.transcription); // Send transcription for AI response
        } else {
             console.warn("Empty transcription received.");
             addMessageToConversation("system", "(No speech detected or transcription failed)");
             state.isAIResponding = false; // AI finished processing (failed transcription)
             // Restart listening?
             if(state.isInterviewActive) startListeningAutomatically();
        }
    })
    .catch(error => {
        console.error('Error processing audio:', error);
        alert(`Error processing your response: ${error.message}`);
        addMessageToConversation("system", `Error processing audio: ${error.message}`);
        state.isAIResponding = false; // AI finished processing (error)
         // Restart listening?
         if(state.isInterviewActive) startListeningAutomatically();
    });
}

function sendUserResponseToBackend(userResponse) {
    console.log("Sending user response to backend for AI reply:", userResponse);
    state.isAIResponding = true; // Expecting AI response now
    animateInterviewer(false); // Ensure interviewer avatar is not 'speaking'

    fetch(`${API_BASE_URL}/interview-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            interviewId: state.interviewId,
            userResponse: userResponse
        })
    })
    .then(response => {
        if (!response.ok) throw new Error(`Failed to get interview response (${response.status})`);
        return response.json();
    })
    .then(data => {
        console.log('Interview response received:', data);
        if (data.interviewerResponse) {
            addMessageToConversation('interviewer', data.interviewerResponse);
            generateAndPlayTTS(data.interviewerResponse); // Plays TTS, which triggers listening again on end
        } else {
             throw new Error("Empty response from interviewer");
        }
        // isAIResponding will be set to false in the TTS onended callback
    })
    .catch(error => {
        console.error('Error getting interviewer response:', error);
        addMessageToConversation('interviewer', `Sorry, an error occurred: ${error.message}. Let's try again.`);
        state.isAIResponding = false; // Reset state on error
        // Restart listening?
         if(state.isInterviewActive) startListeningAutomatically();
    });
}

// --- TTS Function ---

function generateAndPlayTTS(text) {
     if (!text) return;
     console.log("Requesting TTS for:", text);
     state.isAIResponding = true; // AI is about to speak
     animateInterviewer(true); // Start animation


    // --- Attempt 1: Fetch from Backend (Preferred) ---
    fetch(`${API_BASE_URL}/generate-tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
    })
    .then(response => {
        if (!response.ok) {
             // Throw error to trigger fallback
             throw new Error(`Backend TTS failed (${response.status})`);
        }
        return response.json();
    })
    .then(data => {
        if (!data.audioBase64) {
             throw new Error("Backend returned no audio data.");
        }
        console.log("Playing TTS audio from backend");
        const audio = new Audio(`data:audio/mp3;base64,${data.audioBase64}`);

        audio.onended = () => {
            console.log("Backend TTS finished playing.");
            animateInterviewer(false);
            state.isAIResponding = false;
            // Automatically start listening after AI finishes
            if(state.isInterviewActive) startListeningAutomatically();
        };
         audio.onerror = (e) => {
            console.error("Error playing backend audio:", e);
            animateInterviewer(false);
            state.isAIResponding = false;
             if(state.isInterviewActive) startListeningAutomatically(); // Still try to continue
        };
        audio.play().catch(e => { // Handle potential autoplay issues
             console.error("Audio play failed:", e);
             alert("Could not play audio automatically. Please interact with the page.");
             animateInterviewer(false);
             state.isAIResponding = false;
             if(state.isInterviewActive) startListeningAutomatically();
        });
    })
    .catch(error => {
        // --- Attempt 2: Browser Fallback ---
        console.warn(`Backend TTS error: ${error.message}. Falling back to browser TTS.`);
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1;
            utterance.pitch = 1;
            utterance.volume = 1;

            // Try to find a suitable voice (example: prefer 'Google' or 'Daniel')
            const voices = window.speechSynthesis.getVoices();
             // Example: Look for a specific voice or language
             // const preferredVoice = voices.find(voice => voice.lang === 'en-IN') || voices.find(voice => voice.name.includes('Google US English'));
            const preferredVoice = voices.find(voice => voice.name.includes('Google US English')) || voices.find(voice => voice.default && voice.lang.startsWith('en')); // Simple preference
            if (preferredVoice) {
                console.log("Using browser voice:", preferredVoice.name);
                utterance.voice = preferredVoice;
            } else {
                 console.log("Using default browser voice.");
            }


            utterance.onstart = () => {
                 console.log("Browser TTS started.");
                 state.isAIResponding = true;
                 animateInterviewer(true);
            };

            utterance.onend = () => {
                console.log("Browser TTS finished.");
                animateInterviewer(false);
                state.isAIResponding = false;
                // Automatically start listening after AI finishes
                 if(state.isInterviewActive) startListeningAutomatically();
            };

            utterance.onerror = (event) => {
                console.error('Browser SpeechSynthesis Error:', event.error);
                animateInterviewer(false);
                state.isAIResponding = false;
                 // Still try to start listening even if TTS fails
                if(state.isInterviewActive) startListeningAutomatically();
            };

            // Cancel any previous speech before speaking
             window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utterance);
        } else {
            console.error("Browser SpeechSynthesis not supported.");
            alert("Neither backend nor browser TTS is available.");
            animateInterviewer(false);
            state.isAIResponding = false;
            // Can't proceed naturally, maybe just display text?
        }
    });
}


function animateInterviewer(isSpeaking) {
    const interviewerAvatar = document.getElementById('interviewerAvatar');
    const interviewerSpeakingWaves = document.getElementById('interviewerSpeakingWaves');
    if (!interviewerAvatar || !interviewerSpeakingWaves) return;

    if (isSpeaking) {
        interviewerAvatar.classList.add('speaking'); // Add class for potential CSS animation
        interviewerSpeakingWaves.classList.add('active');
    } else {
        interviewerAvatar.classList.remove('speaking');
        interviewerSpeakingWaves.classList.remove('active');
    }
}


// --- Media Controls ---

function toggleCamera() {
    if (state.videoStream) {
        const videoTrack = state.videoStream.getVideoTracks()[0];
        if(videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.getElementById('toggleCameraBtn');
            const icon = btn?.querySelector('i');
            if(icon) icon.className = videoTrack.enabled ? 'fas fa-video' : 'fas fa-video-slash';
            if(btn) btn.classList.toggle('btn-danger', !videoTrack.enabled);
             if(btn) btn.classList.toggle('btn-light', videoTrack.enabled);
        }
    }
}

function toggleMicrophone() {
    // Note: Disabling manual mic toggle in continuous mode might be better
    // Or, it could act as a temporary mute? Complex interaction.
     if (state.videoStream) {
        const audioTrack = state.videoStream.getAudioTracks()[0];
         if (audioTrack) {
             audioTrack.enabled = !audioTrack.enabled; // This mutes/unmutes the track for recording
             const btn = document.getElementById('toggleMicBtn');
             const icon = btn?.querySelector('i');
              if (icon) icon.className = audioTrack.enabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
              if (btn) btn.classList.toggle('btn-danger', !audioTrack.enabled);
              if (btn) btn.classList.toggle('btn-light', audioTrack.enabled);
             console.log(`Microphone track enabled: ${audioTrack.enabled}`);

             // If mic is disabled manually, maybe stop automatic listening?
             if (!audioTrack.enabled && state.isRecording) {
                  console.log("Mic disabled manually, stopping recording.");
                  stopRecordingAndProcess(); // Or just stop without processing?
             }
        }
    }
}


// --- Interview End & Analysis ---

function endInterview() {
    if (!state.interviewId) {
        console.warn('No active interview to end');
        return;
    }
    console.log("Ending interview:", state.interviewId);

    state.isInterviewActive = false; // Stop interview loop
    state.isAIResponding = false;
    // Stop recording if it's active
    if (state.isRecording) {
        stopRecordingAndProcess(); // Stop and process any final utterance
    } else {
         clearTimeout(state.silenceTimer); // Ensure timers are cleared
         clearInterval(state.recordingTimer);
    }


    // Stop media stream tracks
    if (state.videoStream) {
        console.log("Stopping media stream tracks.");
        state.videoStream.getTracks().forEach(track => track.stop());
        state.videoStream = null;
        // Reset video display?
        const videoElement = document.getElementById('candidateVideo');
        if(videoElement) videoElement.srcObject = null;
    }

     // Add visual feedback
    addMessageToConversation("system", "Ending interview and generating analysis...");
    const endBtn = document.getElementById('endInterviewBtn');
    if(endBtn) endBtn.disabled = true; endBtn.textContent = 'Analyzing...';


    fetch(`${API_BASE_URL}/end-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId: state.interviewId })
    })
    .then(response => {
        if (!response.ok) throw new Error(`Failed to end interview (${response.status})`);
        return response.json();
    })
    .then(data => {
        console.log('Interview ended response:', data);
        if (data.analysisStatus === 'processing') {
            pollInterviewAnalysis(state.interviewId); // Start polling for results
        } else {
             // Handle potential immediate completion or error from backend?
             console.warn("Unexpected status after ending interview:", data.status);
             // Maybe still try polling
             pollInterviewAnalysis(state.interviewId);
        }
        // Reset interview ID *after* starting polling for its results
        // state.interviewId = null; // Or keep it to view results? Keep it for now.
    })
    .catch(error => {
        console.error('Error ending interview:', error);
        alert(`Error ending interview: ${error.message}`);
         if(endBtn) endBtn.disabled = false; endBtn.textContent = 'End Interview & Analyze'; // Reset button
         addMessageToConversation("system", `Error ending interview: ${error.message}`);
    });
}

function pollInterviewAnalysis(interviewId) {
    console.log("Polling for interview analysis results for:", interviewId);
    navigateTo('performance'); // Show performance section while polling

    // Add loading state to performance section
    document.getElementById('performance').innerHTML = `
        <div class="container text-center mt-5">
            <h2>Generating Interview Performance Analysis...</h2>
            <p class="section-description">This may take a minute.</p>
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>`;


    const checkAnalysis = () => {
        // Stop polling if interview changed or isn't active anymore (though it should be ended)
        if (state.interviewId !== interviewId) {
            console.log("Interview ID changed, stopping analysis polling for", interviewId);
            return;
        }

        fetch(`${API_BASE_URL}/get-interview-analysis/${interviewId}`)
        .then(response => {
            if (response.status === 202) { // 202 Accepted - Still processing
                console.log("Analysis still processing...");
                setTimeout(checkAnalysis, 5000); // Poll again after 5 seconds
                return null; // Don't continue processing this response
            }
            if (response.status === 500) { // Explicit server error
                 throw new Error("Server error while generating analysis.");
            }
            if (response.status === 404) {
                throw new Error("Interview analysis not found.");
            }
             if (!response.ok) {
                throw new Error(`Failed to get analysis (${response.status})`);
            }
            return response.json();
        })
        .then(data => {
            if (!data) return; // Exit if still processing (returned null)

            console.log('Interview analysis received:', data);
            // Restore original performance section structure before displaying
            restorePerformanceSectionHTML(); // You'll need to define this function or paste the original HTML structure back
            displayInterviewAnalysis(data); // Display results

            // Unlock history section based on results
            fetch(`${API_BASE_URL}/get-progress-history/${state.sessionId}`)
                .then(res => res.ok ? res.json() : null)
                .then(historyData => {
                    if (historyData && historyData.interviews?.length > 0) { // Unlock if any history exists
                         unlockSection('performance'); // Ensure performance is unlocked
                         unlockSection('history');
                    }
                });

             const endBtn = document.getElementById('endInterviewBtn');
             if(endBtn) endBtn.disabled = false; endBtn.textContent = 'End Interview & Analyze'; // Reset button state

        })
        .catch(error => {
            console.error('Error getting interview analysis:', error);
             document.getElementById('performance').innerHTML = `<div class="alert alert-danger">Error retrieving interview analysis: ${error.message}</div>`;
            // Reset end button state
             const endBtn = document.getElementById('endInterviewBtn');
             if(endBtn) endBtn.disabled = false; endBtn.textContent = 'End Interview & Analyze';
        });
    };

    checkAnalysis(); // Start polling
}

// Function to restore the HTML structure of the performance section
// (Needed because we overwrite it with a loading indicator during polling)
function restorePerformanceSectionHTML() {
    const performanceSection = document.getElementById('performance');
    if (!performanceSection) return;
    // Paste the full, original HTML structure from index.html here
    // Including the NEW suggested answers section placeholder
    performanceSection.innerHTML = `
        <div class="container">
            <h2>Interview Performance Analysis</h2>
            <p class="section-description">Here's how you performed in your mock interview</p>

            <div class="row">
                <div class="col-md-4">
                    <div class="card mb-4">
                        <div class="card-body text-center">
                            <h3>Overall Score</h3>
                            <div class="performance-score-circle">
                                <span id="overallPerformanceScore">--</span><span>%</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-8">
                    <div class="card mb-4">
                        <div class="card-body">
                            <h3>Overall Assessment</h3>
                            <p id="overallAssessment">Loading assessment...</p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row score-cards">
                <div class="col-md-4">
                    <div class="card mb-4 score-card">
                        <div class="card-body">
                            <h3>Technical</h3>
                            <div class="score-indicator">
                                <div class="score-value" id="technicalScore">--</div>
                                <div class="score-bar"><div class="score-progress" id="technicalScoreBar" style="width: 0%;"></div></div>
                            </div>
                            <div class="score-details mt-3">
                                <div class="score-strengths"><h5>Strengths</h5><ul id="technicalStrengths"><li>Loading...</li></ul></div>
                                <div class="score-weaknesses"><h5>Areas to Improve</h5><ul id="technicalWeaknesses"><li>Loading...</li></ul></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card mb-4 score-card">
                        <div class="card-body">
                            <h3>Communication</h3>
                            <div class="score-indicator">
                                <div class="score-value" id="communicationScore">--</div>
                                <div class="score-bar"><div class="score-progress" id="communicationScoreBar" style="width: 0%;"></div></div>
                            </div>
                            <div class="score-details mt-3">
                                <div class="score-strengths"><h5>Strengths</h5><ul id="communicationStrengths"><li>Loading...</li></ul></div>
                                <div class="score-weaknesses"><h5>Areas to Improve</h5><ul id="communicationWeaknesses"><li>Loading...</li></ul></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card mb-4 score-card">
                        <div class="card-body">
                            <h3>Behavioral</h3>
                            <div class="score-indicator">
                                <div class="score-value" id="behavioralScore">--</div>
                                <div class="score-bar"><div class="score-progress" id="behavioralScoreBar" style="width: 0%;"></div></div>
                            </div>
                            <div class="score-details mt-3">
                                <div class="score-strengths"><h5>Strengths</h5><ul id="behavioralStrengths"><li>Loading...</li></ul></div>
                                <div class="score-weaknesses"><h5>Areas to Improve</h5><ul id="behavioralWeaknesses"><li>Loading...</li></ul></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card mb-4">
                <div class="card-header"><h3>Key Improvement Areas</h3></div>
                <div class="card-body"><div id="keyImprovementAreas"><p class="text-center">Loading improvement areas...</p></div></div>
            </div>

            <div class="card mb-4">
                <div class="card-header"><h3>Interview Transcript</h3></div>
                <div class="card-body"><div id="interviewTranscript" class="interview-transcript"><p class="text-center">Loading transcript...</p></div></div>
            </div>

            <div class="card mb-4">
                 <div class="card-header"><h3><i class="fas fa-lightbulb me-2"></i> Suggested Answers & Rationale</h3></div>
                 <div class="card-body">
                     <p class="text-muted small">Here are some strong ways you could have answered the interviewer's questions, tailored to your profile.</p>
                     <div id="suggestedAnswersAccordion" class="accordion">
                         <div class="text-center p-3">
                             <div class="spinner-border spinner-border-sm text-primary" role="status">
                                 <span class="visually-hidden">Loading...</span>
                             </div>
                             <span class="ms-2">Loading suggested answers...</span>
                         </div>
                     </div>
                 </div>
             </div>
             <div class="text-center mt-4">
                <button class="btn btn-primary" id="startNewInterviewBtn">Start New Interview</button>
                <button class="btn btn-secondary" id="viewProgressBtn">View Progress History</button>
            </div>
        </div>`; // End of innerHTML

    // Re-attach listeners for the buttons inside this section
     document.getElementById('startNewInterviewBtn')?.addEventListener('click', () => { navigateTo('mock-interview'); showPermissionsModal(); });
     document.getElementById('viewProgressBtn')?.addEventListener('click', () => navigateTo('history'));
}


function displayInterviewAnalysis(analysisData) {
    // Ensure analysisData and analysisData.analysis exist
    if (!analysisData || !analysisData.analysis) {
        console.error("Invalid analysis data received for display.");
        // Attempt to restore the section structure before showing error
        restorePerformanceSectionHTML();
        document.getElementById('performance').innerHTML = '<div class="alert alert-danger">Could not display interview analysis. Data missing.</div>';
        return;
    }
    const analysis = analysisData.analysis;
    const interviewIdForSuggestions = analysisData.interviewId || state.interviewId; // Get ID for suggestions call

    // --- Restore HTML Structure First (Crucial if loading overwrote it) ---
    // Ensure the basic structure exists before populating it
    // restorePerformanceSectionHTML(); // Called by pollInterviewAnalysis before this now

    // --- Populate Data ---

    // Overall Score & Assessment
    const overallScore = analysis.overallScore || 0;
    const overallScoreElement = document.getElementById('overallPerformanceScore');
    const overallCircleElement = document.querySelector('.performance-score-circle'); // Use querySelector for potential future changes
    const overallAssessmentElement = document.getElementById('overallAssessment');

    if (overallScoreElement) overallScoreElement.textContent = overallScore;
    if (overallCircleElement) overallCircleElement.style.setProperty('--percentage', `${overallScore}%`);
    if (overallAssessmentElement) overallAssessmentElement.textContent = analysis.overallAssessment || 'No overall assessment available.';

    // Helper to display score card section
    const displayScoreSection = (sectionId, assessmentData) => {
        const scoreEl = document.getElementById(`${sectionId}Score`);
        const scoreBarEl = document.getElementById(`${sectionId}ScoreBar`);
        const strengthsEl = document.getElementById(`${sectionId}Strengths`);
        const weaknessesEl = document.getElementById(`${sectionId}Weaknesses`);
        const data = assessmentData || {}; // Handle case where assessment section is missing

        if (scoreEl) scoreEl.textContent = data.score !== undefined ? data.score : '--';
        if (scoreBarEl) scoreBarEl.style.width = `${data.score || 0}%`;

        const populateList = (listEl, items, type) => {
            if (!listEl) return;
            listEl.innerHTML = ''; // Clear
            if (items?.length > 0) {
                items.forEach(item => {
                    const li = document.createElement('li');
                    // Use textContent for safety against potential XSS in feedback strings
                    li.innerHTML = `<i class="fas ${type === 'strength' ? 'fa-plus-circle text-success' : 'fa-minus-circle text-danger'} me-2"></i>`;
                    li.appendChild(document.createTextNode(item || 'N/A')); // Append text safely
                    listEl.appendChild(li);
                });
            } else {
                listEl.innerHTML = `<li class="text-muted">None identified.</li>`;
            }
        };

        populateList(strengthsEl, data.strengths, 'strength');
        populateList(weaknessesEl, data.weaknesses, 'weakness');
    };

    displayScoreSection('technical', analysis.technicalAssessment);
    displayScoreSection('communication', analysis.communicationAssessment);
    displayScoreSection('behavioral', analysis.behavioralAssessment);


    // Key Improvement Areas
    const keyImprovementAreasContainer = document.getElementById('keyImprovementAreas');
    if (keyImprovementAreasContainer) {
        keyImprovementAreasContainer.innerHTML = ''; // Clear
        if (analysis.keyImprovementAreas?.length > 0) {
            const listGroup = document.createElement('div');
            listGroup.className = 'list-group';
            analysis.keyImprovementAreas.forEach(area => {
                const item = document.createElement('div'); // Use div, not link 'a'
                item.className = 'list-group-item list-group-item-action flex-column align-items-start'; // Keep classes for styling

                 // Safely create and append text content
                 const headerDiv = document.createElement('div');
                 headerDiv.className = 'd-flex w-100 justify-content-between';
                 const title = document.createElement('h5');
                 title.className = 'mb-1';
                 title.innerHTML = `<i class="fas fa-wrench me-2"></i>`; // Icon is safe
                 title.appendChild(document.createTextNode(area.area || 'Improvement Area'));
                 headerDiv.appendChild(title);
                 item.appendChild(headerDiv);

                 const recommendation = document.createElement('p');
                 recommendation.className = 'mb-1';
                 recommendation.textContent = area.recommendation || 'No specific recommendation.';
                 item.appendChild(recommendation);

                 if (area.practiceExercise) {
                     const practice = document.createElement('small');
                     practice.className = 'text-muted';
                     practice.innerHTML = `<strong>Practice:</strong> `; // Bold tag is safe
                     practice.appendChild(document.createTextNode(area.practiceExercise));
                     item.appendChild(practice);
                 }
                 listGroup.appendChild(item);
            });
            keyImprovementAreasContainer.appendChild(listGroup);
        } else {
            keyImprovementAreasContainer.innerHTML = '<div class="alert alert-light">No specific areas for improvement highlighted.</div>';
        }
    }


    // Interview Transcript
    const interviewTranscriptContainer = document.getElementById('interviewTranscript');
    if (interviewTranscriptContainer) {
        interviewTranscriptContainer.innerHTML = ''; // Clear
        if (analysisData.transcript?.length > 0) {
            analysisData.transcript.forEach(message => {
                const messageElement = document.createElement('div');
                messageElement.className = `transcript-message ${message.speaker?.toLowerCase() || 'unknown'}`;

                const speakerDiv = document.createElement('div');
                speakerDiv.className = 'transcript-speaker';
                speakerDiv.textContent = message.speaker || 'Unknown'; // Safe text

                const textDiv = document.createElement('div');
                textDiv.className = 'transcript-text';
                textDiv.textContent = message.text || '(empty message)'; // Safe text

                messageElement.appendChild(speakerDiv);
                messageElement.appendChild(textDiv);
                interviewTranscriptContainer.appendChild(messageElement);
            });
            interviewTranscriptContainer.scrollTop = interviewTranscriptContainer.scrollHeight; // Scroll to bottom
        } else {
            interviewTranscriptContainer.innerHTML = '<p class="text-muted">Transcript not available.</p>';
        }
    }

    // **** CALL TO LOAD SUGGESTED ANSWERS (Added) ****
    if (interviewIdForSuggestions) {
       console.log(`Analysis displayed, now loading suggested answers for interview: ${interviewIdForSuggestions}`);
       loadSuggestedAnswers(interviewIdForSuggestions);
    } else {
         console.error("Cannot load suggested answers, interview ID not found in analysis data or state.");
         // Display error in the suggested answers section
         const container = document.getElementById('suggestedAnswersAccordion');
          if(container) {
            container.innerHTML = '<div class="alert alert-danger">Could not load suggested answers: Interview ID missing.</div>';
          }
    }
    // **** END OF ADDED CODE ****
}

// --- NEW Function to load suggested answers ---
function loadSuggestedAnswers(interviewId) {
    console.log("Requesting suggested answers for interview:", interviewId);
    const container = document.getElementById('suggestedAnswersAccordion');
    if (!container) return;

    // Show loading state specifically for this section
    container.innerHTML = `
        <div class="text-center p-3">
            <div class="spinner-border spinner-border-sm text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <span class="ms-2">Loading suggested answers...</span>
        </div>`;

    fetch(`${API_BASE_URL}/get-suggested-answers/${interviewId}`)
    .then(response => {
        if (!response.ok) {
            // Try to get error message from backend JSON
             return response.json().then(errData => {
                 throw new Error(errData.error || `Network response was not ok (${response.status})`);
            }).catch(() => {
                 // If backend didn't send JSON error
                 throw new Error(`Network response was not ok (${response.status})`);
             });
        }
        return response.json();
    })
    .then(data => {
        console.log('Suggested answers data received:', data);
        displaySuggestedAnswers(data); // Call display function
    })
    .catch(error => {
        console.error('Error loading suggested answers:', error);
        if (container) {
             container.innerHTML = `<div class="alert alert-warning">Could not load suggested answers: ${error.message}</div>`;
        }
    });
}

// --- NEW Function to display suggested answers ---
function displaySuggestedAnswers(data) {
    const container = document.getElementById('suggestedAnswersAccordion');
    if (!container) return;
    container.innerHTML = ''; // Clear loading state

    if (data.error) {
         container.innerHTML = `<div class="alert alert-warning">Could not generate suggested answers: ${data.error}</div>`;
         return;
    }

    if (!data || !data.suggestedAnswers || data.suggestedAnswers.length === 0) {
        container.innerHTML = '<div class="alert alert-light">No suggested answers were generated for this interview.</div>';
        return;
    }

    data.suggestedAnswers.forEach((item, index) => {
        const question = item.question || "[Question not extracted]";
        const suggestions = item.suggestions || [];

        const accordionItemId = `suggestedAnswerItem-${index}`;
        const headerId = `suggestedAnswerHeader-${index}`;
        const collapseId = `suggestedAnswerCollapse-${index}`;

        const accordionItem = document.createElement('div');
        accordionItem.className = 'accordion-item';

        let suggestionsHTML = '';
        if (suggestions.length > 0) {
            suggestionsHTML = suggestions.map((suggestion, sugIndex) => `
                <div class="suggestion-block mb-3 pb-2 ${sugIndex < suggestions.length - 1 ? 'border-bottom' : ''}">
                    <h6>Suggestion ${sugIndex + 1}:</h6>
                    <p><strong>Answer:</strong> ${suggestion.answer || "N/A"}</p>
                    <p class="text-muted small"><strong><i class="fas fa-info-circle me-1"></i>Rationale:</strong> ${suggestion.rationale || "N/A"}</p>
                </div>
            `).join('');
        } else {
            suggestionsHTML = '<p class="text-muted">No specific suggestions provided for this question.</p>';
        }

        accordionItem.innerHTML = `
            <h2 class="accordion-header" id="${headerId}">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
                   <i class="fas fa-question-circle text-primary me-2"></i> ${question}
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse" aria-labelledby="${headerId}" data-bs-parent="#suggestedAnswersAccordion">
                <div class="accordion-body">
                    ${suggestionsHTML}
                </div>
            </div>
        `;
        container.appendChild(accordionItem);
    });
}


// --- History Section ---

function loadProgressHistory() {
    if (!state.sessionId) {
        console.log('No active session for progress history');
        // Optionally display a message in the history section
        document.getElementById('history').innerHTML = '<div class="container"><p class="alert alert-info">Complete an interview analysis first to see progress history.</p></div>';
        return;
    }

     console.log("Loading progress history for session:", state.sessionId);
     // Display loading state for history
     document.getElementById('history').innerHTML = `
         <div class="container text-center mt-5">
            <h2>Loading Progress History...</h2>
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
         </div>`;

    fetch(`${API_BASE_URL}/get-progress-history/${state.sessionId}`)
    .then(response => {
        if (response.status === 404) return { interviews: [], trends: null, message: "No history found yet." }; // Handle no history gracefully
        if (!response.ok) throw new Error(`Failed to get progress history (${response.status})`);
        return response.json();
    })
    .then(data => {
        console.log('Progress history data:', data);
        // Restore original history section structure
        restoreHistorySectionHTML(); // You'll need to define this
        displayProgressHistory(data); // Display the data
    })
    .catch(error => {
        console.error('Error loading progress history:', error);
        document.getElementById('history').innerHTML = `<div class="container"><div class="alert alert-danger">Error loading progress history: ${error.message}</div></div>`;
    });
}

// Function to restore the HTML structure of the history section
function restoreHistorySectionHTML() {
     const historySection = document.getElementById('history');
     if (!historySection) return;
     // Paste the original HTML structure from index.html here
     historySection.innerHTML = `
        <div class="container">
            <h2>Progress History</h2>
            <p class="section-description">Track your improvement across multiple mock interviews</p>
            <div class="card mb-4">
                <div class="card-header"><h3>Performance Trends</h3></div>
                <div class="card-body">
                    <div class="chart-container" style="height: 300px;"> <canvas id="progressChart"></canvas>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6">
                    <div class="card mb-4">
                        <div class="card-header"><h3>Improvement Summary</h3></div>
                        <div class="card-body"><div id="improvementSummary"><p class="text-center">Loading summary...</p></div></div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card mb-4">
                        <div class="card-header"><h3>Past Interviews</h3></div>
                        <div class="card-body"><div id="pastInterviewsList" class="past-interviews-list"><p class="text-center">Loading past interviews...</p></div></div>
                    </div>
                </div>
            </div>
            <div class="text-center mt-4">
                <button class="btn btn-primary" id="startAnotherInterviewBtn">Start Another Interview</button>
            </div>
        </div>`;
        // Re-attach listener
        document.getElementById('startAnotherInterviewBtn')?.addEventListener('click', () => { navigateTo('mock-interview'); showPermissionsModal(); });
}


function displayProgressHistory(historyData) {
     const improvementSummary = document.getElementById('improvementSummary');
     const pastInterviewsList = document.getElementById('pastInterviewsList');
     const chartCanvas = document.getElementById('progressChart'); // Get canvas element

     if (!improvementSummary || !pastInterviewsList || !chartCanvas) {
          console.error("History UI elements missing.");
          return;
     }

    // Improvement Summary
     improvementSummary.innerHTML = ''; // Clear loading
     const trends = historyData.trends;
     const totalInterviews = historyData.interviews?.length || 0;

     if (totalInterviews > 1 && trends) {
         const createTrendValueHTML = (value) => {
             const numValue = Number(value) || 0;
             const sign = numValue > 0 ? '+' : '';
             const colorClass = numValue > 0 ? 'text-success' : numValue < 0 ? 'text-danger' : 'text-muted';
             return `<span class="fw-bold ${colorClass}">${sign}${numValue} pts</span>`;
         };
         improvementSummary.innerHTML = `
             <div class="alert alert-info">
                 <h5>Progress Overview</h5>
                 <p>Completed ${totalInterviews} interviews. Showing trends from first to latest.</p>
                 <p>Overall Change: ${createTrendValueHTML(trends.overallImprovement)}</p>
             </div>
             <div class="d-flex justify-content-around text-center">
                 <div>Technical<br>${createTrendValueHTML(trends.technicalImprovement)}</div>
                 <div>Communication<br>${createTrendValueHTML(trends.communicationImprovement)}</div>
                 <div>Behavioral<br>${createTrendValueHTML(trends.behavioralImprovement)}</div>
             </div>`;
     } else if (totalInterviews === 1) {
         improvementSummary.innerHTML = '<div class="alert alert-light">Complete more interviews to see improvement trends.</div>';
     } else {
          improvementSummary.innerHTML = '<div class="alert alert-light">No interview history found.</div>';
     }

    // Past Interviews List
     pastInterviewsList.innerHTML = ''; // Clear loading
     if (totalInterviews > 0) {
         // Sort interviews newest first for display
         const sortedInterviews = [...historyData.interviews].sort((a, b) => new Date(b.date) - new Date(a.date));
         sortedInterviews.forEach((interview, index) => {
             const item = document.createElement('div');
             item.className = 'past-interview-item list-group-item'; // Use list-group-item for better spacing maybe
             const date = new Date(interview.date);
             const formattedDate = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
             const formattedTime = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit'});

             item.innerHTML = `
                 <div class="d-flex w-100 justify-content-between">
                     <h6 class="mb-1">Interview #${totalInterviews - index} (${formattedDate})</h6>
                     <span class="badge bg-primary rounded-pill p-2">Overall: ${interview.overallScore || 'N/A'}</span>
                 </div>
                 <small class="text-muted">${formattedTime} - Type: ${interview.interviewType || 'General'}</small> <div class="d-flex justify-content-around mt-1 small">
                      <span>Tech: ${interview.technicalScore || 'N/A'}</span>
                      <span>Comm: ${interview.communicationScore || 'N/A'}</span>
                      <span>Behav: ${interview.behavioralScore || 'N/A'}</span>
                 </div>
                 `;
             pastInterviewsList.appendChild(item);
         });
     } else {
         pastInterviewsList.innerHTML = '<p class="text-muted">No past interviews recorded.</p>';
     }

    // Progress Chart
    displayProgressChart(historyData, chartCanvas); // Pass canvas element
}


// --- Charting ---
let progressChartInstance = null; // Keep track of the chart instance

function displayProgressChart(historyData, canvasElement) {
    if (!canvasElement) {
         console.error("Chart canvas element not found");
         return;
    }
    const ctx = canvasElement.getContext('2d');

     // Destroy previous chart instance if it exists
    if (progressChartInstance) {
        progressChartInstance.destroy();
        progressChartInstance = null;
    }


    if (!historyData.interviews || historyData.interviews.length < 1) {
        // Optionally display a message on the canvas if no data
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height); // Clear canvas
        ctx.textAlign = 'center';
        ctx.fillText('Complete interviews to see progress chart.', canvasElement.width / 2, 50);
        return;
    }

    // Sort interviews by date (oldest first for chart)
    const sortedInterviews = [...historyData.interviews].sort((a, b) => new Date(a.date) - new Date(b.date));

    const labels = sortedInterviews.map((_, index) => `Interview ${index + 1}`); // Simple labels
    const overallData = sortedInterviews.map(interview => interview.overallScore);
    const technicalData = sortedInterviews.map(interview => interview.technicalScore);
    const communicationData = sortedInterviews.map(interview => interview.communicationScore);
    const behavioralData = sortedInterviews.map(interview => interview.behavioralScore);

    progressChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Overall', data: overallData, borderColor: 'rgba(74, 111, 220, 1)', backgroundColor: 'rgba(74, 111, 220, 0.1)', tension: 0.1, borderWidth: 2, fill: true },
                { label: 'Technical', data: technicalData, borderColor: 'rgba(75, 192, 192, 1)', backgroundColor: 'rgba(75, 192, 192, 0.1)', tension: 0.1, hidden: true }, // Hide less important ones initially?
                { label: 'Communication', data: communicationData, borderColor: 'rgba(255, 159, 64, 1)', backgroundColor: 'rgba(255, 159, 64, 0.1)', tension: 0.1, hidden: true },
                { label: 'Behavioral', data: behavioralData, borderColor: 'rgba(153, 102, 255, 1)', backgroundColor: 'rgba(153, 102, 255, 0.1)', tension: 0.1, hidden: true }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false, // Allow chart to fill container height
            scales: {
                y: { beginAtZero: true, max: 100, title: { display: true, text: 'Score' } },
                x: { title: { display: true, text: 'Interview Session' } }
            },
            plugins: {
                legend: { position: 'top' },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
}


// --- Conversation Display ---

function addMessageToConversation(role, content) {
    const conversationContainer = document.getElementById('conversationContainer');
    if (!conversationContainer) return;

    const messageElement = document.createElement('div');
    messageElement.classList.add('message', role); // Role: interviewer, candidate, system

    const senderElement = document.createElement('div');
    senderElement.className = 'sender';
    let senderName = 'System';
    if (role === 'interviewer') senderName = 'IRIS Interviewer';
    if (role === 'candidate') senderName = 'You';
    senderElement.textContent = senderName;

    const contentElement = document.createElement('div');
    // Sanitize content before adding? Basic prevention:
    contentElement.textContent = content; // Use textContent to prevent XSS

    messageElement.appendChild(senderElement);
    messageElement.appendChild(contentElement);
    conversationContainer.appendChild(messageElement);

    // Scroll to bottom
    conversationContainer.scrollTop = conversationContainer.scrollHeight;

    // Add to logical history (only user/assistant roles for backend)
    if (role === 'interviewer' || role === 'candidate') {
        state.conversationHistory.push({
            role: role === 'interviewer' ? 'assistant' : 'user',
            content: content
        });
    }
}

// NEW function (or modified pollAnalysisStatus start) in app.js
function checkAndLoadSessionStatus(sessionId) {
    console.log(`Checking status for session: ${sessionId}`);
    lockAllSections(); // Start with sections locked

    // Show a general loading indicator maybe?
    // Or just let the UI update based on the status check

    fetch(`${API_BASE_URL}/get-analysis-status/${sessionId}`)
        .then(response => {
            if (response.status === 404) {
                console.warn(`Session ${sessionId} from profile not found in backend. Clearing from profile.`);
                const user = irisAuth?.getCurrentUser();
                // Attempt to clear the invalid ID from the user's profile
                if (user && typeof firebase !== 'undefined' && firebase.firestore) {
                    const db = firebase.firestore(); // Get Firestore instance
                    db.collection('users').doc(user.uid).update({
                         lastActiveSessionId: firebase.firestore.FieldValue.delete() // Use FieldValue.delete()
                    }).catch(err => console.error("Failed to clear invalid sessionId from profile:", err));
                }
                lockAllSections(); // Ensure locked
                navigateTo('upload'); // Start fresh
                return null; // Stop processing this response
            }
            if (!response.ok) throw new Error(`Network response was not ok (${response.status}) checking session status`);
            return response.json();
        })
        .then(statusData => {
            if (!statusData) return; // Exit if session was not found (handled above)

            // *** IMPORTANT: Set the global state session ID ***
            state.sessionId = sessionId;
            console.log(`Set active session ID in state: ${state.sessionId}`);

            if (statusData.status === 'completed') {
                console.log(`Session ${sessionId} analysis complete. Loading data.`);
                unlockSection('analysis');
                unlockSection('prep-plan');
                unlockSection('mock-interview');
                // Check history and unlock performance/history based on actual interviews for *this* session
                checkAndUnlockHistorySections(sessionId);

                // Load the actual data now that sections are unlocked
                loadAnalysisResults(sessionId);
                loadPreparationPlan(sessionId);
                // Decide where to navigate - analysis seems logical
                navigateTo('analysis');
            } else if (statusData.status === 'processing') {
                console.log(`Session ${sessionId} still processing. Restarting polling.`);
                const progressContainer = document.getElementById('uploadProgress');
                const progressBar = document.querySelector('#uploadProgress .progress-bar');
                const progressMessage = document.getElementById('progressMessage');
                if (progressContainer) progressContainer.style.display = 'block';
                if (progressBar) progressBar.style.width = `${statusData.progress || 0}%`;
                if (progressMessage) progressMessage.textContent = `Analysis in progress (${statusData.progress || 0}%)...`;
                pollAnalysisStatus(sessionId); // Resume polling - ensure pollAnalysisStatus uses state.sessionId
                navigateTo('upload'); // Stay on upload page while polling resumes
            } else { // Failed or unknown status
                console.warn(`Session ${sessionId} has status: ${statusData.status}. Starting fresh.`);
                lockAllSections(); // Keep locked
                navigateTo('upload');
            }
        })
        .catch(error => {
            console.error('Error checking session status from profile:', error);
            lockAllSections(); // Lock on error
            navigateTo('upload'); // Go to upload on error
        });
}

// NEW Helper function in app.js to check history and unlock sections
function checkAndUnlockHistorySections(sessionIdToCheck) {
   if (!sessionIdToCheck) return; // Need a session ID
    fetch(`${API_BASE_URL}/get-progress-history/${sessionIdToCheck}`)
         .then(res => {
             if (!res.ok) { // Handle non-200 responses gracefully (e.g., 404 if no history yet)
                 console.log(`No history found or error fetching for session ${sessionIdToCheck} (status: ${res.status}). Keeping sections locked.`);
                  return null;
             }
             return res.json();
         })
         .then(historyData => {
             if (historyData && historyData.interviews?.length > 0) {
                  console.log(`Found ${historyData.interviews.length} past interviews for session ${sessionIdToCheck}. Unlocking performance/history.`);
                  unlockSection('performance');
                  unlockSection('history');
             } else {
                  console.log(`No interview history found for session ${sessionIdToCheck}. Keeping performance/history locked.`);
                  lockSection('performance'); // Ensure they remain locked if no history
                  lockSection('history');
             }
         })
          .catch(err => {
             console.error(`Error checking history for session ${sessionIdToCheck}:`, err);
             lockSection('performance'); // Lock on error
             lockSection('history');
          });
}

// --- Function to check feature access before performing actions ---
function checkFeatureAccess(featureType) {
    // Check if user is authenticated
    const user = firebase.auth().currentUser;
    if (!user) {
        showMessage('Please sign in to use this feature', 'warning');
        if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignInModal === 'function') {
            irisAuth.showSignInModal();
        }
        return false;
    }
    
    // Check if user can use this feature based on their plan
    if (!irisAuth.canUseFeature(featureType)) {
        const usageInfo = irisAuth.getUserProfile()?.usage?.[featureType] || { used: 0, limit: 0 };
        
        // If they've hit their limit, show upgrade modal
        if (usageInfo.used >= usageInfo.limit) {
            showMessage(`You've reached your ${featureType === 'resumeAnalyses' ? 'resume analysis' : 'mock interview'} limit (${usageInfo.used}/${usageInfo.limit}). Please upgrade your plan to continue.`, 'warning');
            showUpgradeModal(featureType);
            return false;
        }
    }
    
    return true;
}

// --- New function to update usage display ---
function updateUsageDisplay() {
    const userProfile = irisAuth?.getUserProfile();
    if (!userProfile || !userProfile.usage) return;
    
    // Update resume analyses counter
    const resumeUsage = userProfile.usage.resumeAnalyses || { used: 0, limit: 0 };
    const resumeCountElement = document.getElementById('resumeAnalysesCount');
    const resumeProgressBar = document.querySelector('#resumeAnalysesCount + .progress .progress-bar');
    
    if (resumeCountElement) {
        resumeCountElement.textContent = `${resumeUsage.used}/${resumeUsage.limit}`;
    }
    
    if (resumeProgressBar) {
        const percentUsed = resumeUsage.limit > 0 ? (resumeUsage.used / resumeUsage.limit) * 100 : 0;
        resumeProgressBar.style.width = `${Math.min(100, percentUsed)}%`;
        
        // Add warning color if close to limit
        if (percentUsed >= 85) {
            resumeProgressBar.classList.add('bg-warning');
        } else if (percentUsed >= 100) {
            resumeProgressBar.classList.add('bg-danger');
        } else {
            resumeProgressBar.classList.remove('bg-warning', 'bg-danger');
        }
    }
    
    // Update mock interviews counter
    const interviewUsage = userProfile.usage.mockInterviews || { used: 0, limit: 0 };
    const interviewCountElement = document.getElementById('mockInterviewsCount');
    const interviewProgressBar = document.querySelector('#mockInterviewsCount + .progress .progress-bar');
    
    if (interviewCountElement) {
        interviewCountElement.textContent = `${interviewUsage.used}/${interviewUsage.limit}`;
    }
    
    if (interviewProgressBar) {
        const percentUsed = interviewUsage.limit > 0 ? (interviewUsage.used / interviewUsage.limit) * 100 : 0;
        interviewProgressBar.style.width = `${Math.min(100, percentUsed)}%`;
        
        // Add warning color if close to limit
        if (percentUsed >= 85) {
            interviewProgressBar.classList.add('bg-warning');
        } else if (percentUsed >= 100) {
            interviewProgressBar.classList.add('bg-danger');
        } else {
            interviewProgressBar.classList.remove('bg-warning', 'bg-danger');
        }
    }
    
    // Update upgrade button visibility based on usage
    const upgradePlanBtn = document.getElementById('upgradePlanBtn');
    if (upgradePlanBtn) {
        // Show more prominently if close to limits
        if (resumeUsage.used >= resumeUsage.limit || interviewUsage.used >= interviewUsage.limit) {
            upgradePlanBtn.classList.add('btn-danger');
            upgradePlanBtn.classList.remove('btn-success');
            upgradePlanBtn.innerHTML = '<i class="fas fa-crown me-2"></i> Upgrade Now - Limits Reached!';
        } else if ((resumeUsage.limit > 0 && resumeUsage.used / resumeUsage.limit >= 0.7) || 
                  (interviewUsage.limit > 0 && interviewUsage.used / interviewUsage.limit >= 0.7)) {
            upgradePlanBtn.classList.add('btn-warning');
            upgradePlanBtn.classList.remove('btn-success', 'btn-danger');
            upgradePlanBtn.innerHTML = '<i class="fas fa-crown me-2"></i> Upgrade Soon - Limits Approaching';
        } else {
            upgradePlanBtn.classList.add('btn-success');
            upgradePlanBtn.classList.remove('btn-warning', 'btn-danger');
            upgradePlanBtn.innerHTML = '<i class="fas fa-crown me-2"></i> Upgrade Now';
        }
    }
}

// --- New function to show upgrade modal (continued) ---
function showUpgradeModal(featureType) {
    // Get current plan to determine what plans to highlight
    const currentPlan = irisAuth?.getUserProfile()?.plan || 'free';
    const modalContent = document.createElement('div');
    
    // Determine recommended plan based on feature and current plan
    let recommendedPlan = 'standard'; // Default recommendation
    
    if (featureType === 'resumeAnalyses') {
        if (currentPlan === 'free') {
            recommendedPlan = 'starter'; // From free to starter for more resume analyses
        } else if (currentPlan === 'starter') {
            recommendedPlan = 'standard'; // From starter to standard for even more
        }
    } else if (featureType === 'mockInterviews') {
        if (currentPlan === 'free' || currentPlan === 'starter') {
            recommendedPlan = 'standard'; // From free/starter to standard for interviews
        } else if (currentPlan === 'standard') {
            recommendedPlan = 'pro'; // From standard to pro for more interviews
        }
    }
    
    // Dynamic heading based on feature
    const heading = featureType === 'resumeAnalyses' 
        ? 'Upgrade for More Resume Analyses'
        : 'Upgrade for Mock Interviews';
    
    modalContent.innerHTML = `
        <div class="modal fade" id="upgradeModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${heading}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info">
                            <i class="fas fa-info-circle me-2"></i>
                            <strong>You've reached your ${featureType === 'resumeAnalyses' ? 'resume analysis' : 'mock interview'} limit on your current plan (${currentPlan}).</strong>
                            <p class="mb-0">Upgrade to continue your interview preparation journey.</p>
                        </div>
                        
                        <div class="row mt-4">
                            <!-- Starter Plan -->
                            <div class="col-md-4 mb-4">
                                <div class="card ${recommendedPlan === 'starter' ? 'border-primary' : ''}">
                                    <div class="card-header">
                                        <h3 class="my-0 font-weight-normal">Starter Pack</h3>
                                        ${recommendedPlan === 'starter' ? '<span class="badge bg-primary position-absolute top-0 end-0 mt-2 me-2">Recommended</span>' : ''}
                                    </div>
                                    <div class="card-body">
                                        <h2 class="card-title pricing-card-title text-center">₹299</h2>
                                        <ul class="list-unstyled mt-3 mb-4">
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>5 Resume Analyses</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>1 Mock Interview</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> Detailed Prep Plan</li>
                                            <li><i class="fas fa-check text-success me-2"></i> Detailed Performance Report</li>
                                            <li><i class="fas fa-check text-success me-2"></i> Dynamic Timeline Generator</li>
                                            <li class="text-muted"><i class="fas fa-times me-2"></i> Suggested Answers Library</li>
                                        </ul>
                                        <button type="button" class="btn btn-lg btn-block ${recommendedPlan === 'starter' ? 'btn-primary' : 'btn-outline-primary'} w-100 plan-select-btn" data-plan="starter">Select Starter</button>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Standard Plan -->
                            <div class="col-md-4 mb-4">
                                <div class="card ${recommendedPlan === 'standard' ? 'border-primary highlight-card' : ''}">
                                    <div class="card-header">
                                        <h3 class="my-0 font-weight-normal">Standard Pack</h3>
                                        ${recommendedPlan === 'standard' ? '<span class="badge bg-primary position-absolute top-0 end-0 mt-2 me-2">Recommended</span>' : ''}
                                    </div>
                                    <div class="card-body">
                                        <h2 class="card-title pricing-card-title text-center">₹499</h2>
                                        <ul class="list-unstyled mt-3 mb-4">
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>10 Resume Analyses</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>3 Mock Interviews</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> Detailed Prep Plan</li>
                                            <li><i class="fas fa-check text-success me-2"></i> Detailed Performance Reports</li>
                                            <li><i class="fas fa-check text-success me-2"></i> Dynamic Timeline Generator</li>
                                            <li><i class="fas fa-check text-success me-2"></i> Suggested Answers Library</li>
                                        </ul>
                                        <button type="button" class="btn btn-lg btn-block ${recommendedPlan === 'standard' ? 'btn-primary' : 'btn-outline-primary'} w-100 plan-select-btn" data-plan="standard">Choose Standard</button>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Pro Plan -->
                            <div class="col-md-4 mb-4">
                                <div class="card ${recommendedPlan === 'pro' ? 'border-primary' : ''}">
                                    <div class="card-header">
                                        <h3 class="my-0 font-weight-normal">Pro Pack</h3>
                                        ${recommendedPlan === 'pro' ? '<span class="badge bg-primary position-absolute top-0 end-0 mt-2 me-2">Recommended</span>' : ''}
                                    </div>
                                    <div class="card-body">
                                        <h2 class="card-title pricing-card-title text-center">₹899</h2>
                                        <ul class="list-unstyled mt-3 mb-4">
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>10 Resume Analyses</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>5 Mock Interviews</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> Detailed Prep Plan</li>
                                            <li><i class="fas fa-check text-success me-2"></i> Detailed Performance Reports</li>
                                            <li><i class="fas fa-check text-success me-2"></i> Dynamic Timeline Generator</li>
                                            <li><i class="fas fa-check text-success me-2"></i> Suggested Answers Library</li>
                                        </ul>
                                        <button type="button" class="btn btn-lg btn-block ${recommendedPlan === 'pro' ? 'btn-primary' : 'btn-outline-primary'} w-100 plan-select-btn" data-plan="pro">Go Pro</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Append modal to body
    document.body.appendChild(modalContent);
    
    // Initialize Bootstrap modal
    const upgradeModal = new bootstrap.Modal(document.getElementById('upgradeModal'));
    upgradeModal.show();
    
    // Add event listeners to plan select buttons
    document.querySelectorAll('.plan-select-btn').forEach(button => {
        button.addEventListener('click', function() {
            const planName = this.getAttribute('data-plan');
            selectPlan(planName, upgradeModal);
        });
    });
    
    // Clean up when modal is hidden
    document.getElementById('upgradeModal').addEventListener('hidden.bs.modal', function() {
        document.body.removeChild(modalContent);
    });
}

// --- Function to handle plan selection ---
function selectPlan(planName, modalInstance) {
    console.log(`Selected plan: ${planName}`);
    
    // Create payment processing modal (temporary, will be replaced with Razorpay integration)
    const processingModalContent = document.createElement('div');
    processingModalContent.innerHTML = `
        <div class="modal fade" id="paymentProcessingModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Processing Payment</h5>
                    </div>
                    <div class="modal-body text-center">
                        <div class="spinner-border text-primary mb-3" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <p>Processing your upgrade to the ${planName.charAt(0).toUpperCase() + planName.slice(1)} plan...</p>
                        <div class="progress mt-3">
                            <div id="payment-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Hide the upgrade modal
    if (modalInstance) {
        modalInstance.hide();
    }
    
    // Append and show processing modal
    document.body.appendChild(processingModalContent);
    const processingModal = new bootstrap.Modal(document.getElementById('paymentProcessingModal'));
    processingModal.show();
    
    // Simulate payment processing (for testing)
    const progressBar = document.getElementById('payment-progress-bar');
    let progress = 0;
    
    const progressInterval = setInterval(() => {
        progress += 10;
        progressBar.style.width = `${progress}%`;
        
        if (progress >= 100) {
            clearInterval(progressInterval);
            setTimeout(() => {
                // Simulate successful payment
                processingModal.hide();
                
                // Update the user's plan
                irisAuth.updateUserPlan(planName)
                    .then(() => {
                        showMessage(`Successfully upgraded to ${planName.charAt(0).toUpperCase() + planName.slice(1)} plan!`, 'success');
                        updateUsageDisplay();
                        document.body.removeChild(processingModalContent);
                    })
                    .catch(error => {
                        showMessage(`Error upgrading plan: ${error.message}`, 'danger');
                        document.body.removeChild(processingModalContent);
                    });
            }, 1000);
        }
    }, 300);
}


// NEW Helper function in app.js to lock sections dependent on analysis
function lockAllSections() {
   lockSection('analysis');
   lockSection('prep-plan');
   lockSection('mock-interview');
   lockSection('performance');
   lockSection('history');
}