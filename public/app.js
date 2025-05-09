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
    // Wait a moment for Firebase Auth to initialize
    setTimeout(function() {
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
        initAddonPurchaseModal();
        enhanceModalCloseHandlers();
        
        // Add this line to initialize the modal fixes
        initModalFixes();

        // Load available browser voices (for fallback TTS)
        loadVoices();
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = loadVoices;
        }

        // Check browser support
        checkBrowserSupport();

        // REMOVED: Old job listings tab button event listener
        // We'll use the improved tab buttons instead
        
        // NEW: Initialize improved tab buttons for smoother tab switching
        initImprovedTabButtons();
        
        // Add these new lines to check for pending mock interviews
        // This is important to handle cases where users come from job listings,
        // log in, and need to be redirected to the upload page with the job description
        if (firebase.auth().currentUser) {
            // Check if there's a pending mock interview
            const pendingJobId = localStorage.getItem('pendingMockInterviewJobId');
            if (pendingJobId) {
                console.log("Found pending mock interview job ID:", pendingJobId);
                
                // Give some time for the app to fully initialize before proceeding
                setTimeout(() => {
                    checkPendingMockInterview();
                }, 1000);
            }
        } else {
            // Set up a listener for when auth state changes to check again
            const unsubscribe = firebase.auth().onAuthStateChanged(function(user) {
                if (user) {
                    // User just logged in, check for pending mock interview
                    const pendingJobId = localStorage.getItem('pendingMockInterviewJobId');
                    if (pendingJobId) {
                        console.log("Auth state changed, found pending mock interview:", pendingJobId);
                        setTimeout(() => {
                            checkPendingMockInterview();
                        }, 1000);
                    }
                    // Remove this listener since we only need to check once after login
                    unsubscribe();
                }
            });
        }
        
        // Also enhance the job listing functions to properly attach event listeners
        if (typeof loadPublicJobListings === 'function') {
            enhanceLoadPublicJobListings();
        }
        
        if (typeof displayJobListings === 'function') {
            enhanceDisplayJobListings();
        }
        
    }, 300); // Wait 300ms for Firebase Auth to initialize
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
        
        // Store the session ID before checking status
        state.sessionId = lastSessionId;
        
        // First, check and load session status for resume analysis
        checkAndLoadSessionStatus(lastSessionId);
        
        // Next, initialize the performance section for interview analysis
        // This ensures interview data loads regardless of which section is active
        initializePerformanceSection();
    } else {
        console.log("No last active session found for this user. Starting fresh.");
        lockAllSections();
        navigateTo('upload');
    }
}

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
            document.getElementById('profileRole').value = profile?.role || 'student';
            document.getElementById('profileCollegeId').value = profile?.collegeId || '';
            document.getElementById('profileDeptId').value = profile?.deptId || '';
            document.getElementById('profileSectionId').value = profile?.sectionId || '';
        }
    });
    
    document.getElementById('cancelEditBtn')?.addEventListener('click', function() {
        document.getElementById('profileViewMode').style.display = 'block';
        document.getElementById('profileEditForm').style.display = 'none';
    });
    
    document.getElementById('profileEditForm')?.addEventListener('submit', function(e) {
        e.preventDefault();
        const newName = document.getElementById('profileName').value.trim();
        const newCollegeId = document.getElementById('profileCollegeId').value.trim();
        const newDeptId = document.getElementById('profileDeptId').value.trim();
        const newSectionId = document.getElementById('profileSectionId').value.trim();
        
        const user = firebase.auth().currentUser;
        if (user) {
            const submitBtn = this.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
            
            // Update user profile in Firebase Auth
            user.updateProfile({ displayName: newName })
                .then(() => {
                    if (firebase.firestore) {
                        // Update user profile in Firestore
                        return firebase.firestore().collection('users').doc(user.uid).update({
                            displayName: newName,
                            collegeId: newCollegeId || null,
                            deptId: newDeptId || null,
                            sectionId: newSectionId || null,
                            updatedAt: new Date().toISOString()
                        });
                    }
                })
                .then(() => {
                    // Update local profile data
                    if (authState && authState.userProfile) {
                        authState.userProfile.displayName = newName;
                        authState.userProfile.collegeId = newCollegeId || null;
                        authState.userProfile.deptId = newDeptId || null;
                        authState.userProfile.sectionId = newSectionId || null;
                    }
                    
                    // Update UI
                    document.getElementById('profileViewMode').style.display = 'block';
                    document.getElementById('profileEditForm').style.display = 'none';
                    document.querySelectorAll('.user-display-name').forEach(el => { el.textContent = newName; });
                    document.getElementById('userCollegeId').textContent = newCollegeId || 'Not specified';
                    document.getElementById('userDeptId').textContent = newDeptId || 'Not specified';
                    document.getElementById('userSectionId').textContent = newSectionId || 'Not specified';
                    
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

    // Add "Buy Add-ons" button initialization
    document.querySelectorAll('.buy-addon-btn').forEach(button => {
        button.addEventListener('click', function() {
            const featureType = this.getAttribute('data-feature');
            showAddonPurchaseModal(featureType);
        });
    });

    // --- The rest of the function remains unchanged ---
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
    showExistingUpgradeModal(currentPlan === 'free' ? 'resumeAnalyses' : 'mockInterviews');
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
                // Remove sensitive information if needed
                if (userData.profile.hasOwnProperty('password')) {
                    delete userData.profile.password;
                }
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

            // Prevent navigation if locked (unless it's upload, landing, or resume-builder)
            const isLocked = this.querySelector('.status-indicator.locked');
            // --- Updated Condition ---
            if (this.classList.contains('active') || (isLocked && !['upload', 'landing', 'resume-builder'].includes(targetSection))) {
            // --- End Updated Condition ---
                return;
            }

            // Switch active nav item
            document.querySelector('.nav-item.active')?.classList.remove('active');
            this.classList.add('active');

            // Switch active content section
            document.querySelector('.content-section.active')?.classList.remove('active');
            const targetElement = document.getElementById(targetSection);
            if (targetElement) {
                targetElement.classList.add('active');
            } else {
                console.warn(`Navigation target element #${targetSection} not found.`);
            }


            // Special actions when navigating
            if (targetSection === 'history') {
                loadProgressHistory();
            }
             // --- Added Action for Resume Builder ---
            if (targetSection === 'resume-builder') {
                // Call function to attach listeners etc. for the resume builder
                // Ensure initResumeBuilder() is defined elsewhere in your app.js
                if (typeof initResumeBuilder === 'function') {
                    initResumeBuilder();
                } else {
                    console.warn('initResumeBuilder function not found.');
                }
            }
             // --- End Added Action ---
        });
    });
}

function initButtons() {
    // --- General Navigation --- 
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

    // --- Mock Interview Controls ---
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
    
    // --- Add Upgrade Plan button event listener ---
    document.getElementById('upgradePlanBtn')?.addEventListener('click', showPaymentModal);
    document.getElementById('fullscreenBtn')?.addEventListener('click', toggleFullscreen);
    
    // --- Add event listeners for pricing section buttons ---
    // These are the buttons in the public pricing section
    document.querySelectorAll('.pricing-plan-btn').forEach(button => {
        button.addEventListener('click', function() {
            const planName = this.getAttribute('data-plan');
            
            // Check if user is logged in
            if (firebase.auth().currentUser) {
                // User is logged in, check if email is verified
                if (authState.isEmailVerified) {
                    // Email is verified, proceed to payment
                    selectPlanFixed(planName);
                } else {
                    // Email is not verified, store selection and show verification modal
                    localStorage.setItem('postVerificationPlan', planName);
                    showMessage('Please verify your email before upgrading your plan', 'warning');
                    showEmailVerificationModal(firebase.auth().currentUser.email);
                }
            } else {
                // User is not logged in, show auth modal first
                // Store selected plan in localStorage to retrieve after login
                localStorage.setItem('pendingPlanSelection', planName);
                
                // Show sign up modal
                if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignUpModal === 'function') {
                    irisAuth.showSignUpModal(); // Preferably signup, not signin
                }
            }
        });
    });
    
    
    // --- Handlers for plan buttons inside the upgrade modal ---
    document.querySelectorAll('.plan-select-btn').forEach(button => {
        // Skip free plan button which is handled by auth system
        if (button.getAttribute('data-plan') === 'free' && button.hasAttribute('data-auth')) {
            return;
        }
        
        button.addEventListener('click', function() {
            const planName = this.getAttribute('data-plan');
            
            // For paid plans inside modals, always use the new payment flow
            if (planName !== 'free') {
                // Hide any parent modal first
                const parentModal = this.closest('.modal');
                if (parentModal && bootstrap.Modal.getInstance(parentModal)) {
                    bootstrap.Modal.getInstance(parentModal).hide();
                }
                
                // Start payment process
                setTimeout(() => {
                    selectPlanFixed(planName);
                }, 300); // Short delay to allow modal to hide
            }
        });
    });
    
    // --- Add-on purchase from pricing page ---
    document.querySelectorAll('.pricing-section-addon-btn').forEach(button => {
        button.addEventListener('click', function() {
            const featureType = this.getAttribute('data-feature');
            const quantity = parseInt(this.getAttribute('data-quantity') || '1');
            
            // Check if user is logged in
            if (firebase.auth().currentUser) {
                // User is logged in, check if email is verified
                if (authState.isEmailVerified) {
                    // Email is verified, proceed to payment
                    purchaseAddonItem(featureType, quantity);
                } else {
                    // Email is not verified, store selection and show verification modal
                    localStorage.setItem('postVerificationAddon', JSON.stringify({
                        featureType: featureType,
                        quantity: quantity
                    }));
                    showMessage('Please verify your email before purchasing add-ons', 'warning');
                    showEmailVerificationModal(firebase.auth().currentUser.email);
                }
            } else {
                // User is not logged in, show auth modal first
                localStorage.setItem('pendingAddonPurchase', JSON.stringify({
                    featureType: featureType,
                    quantity: quantity
                }));
                
                // Show sign up modal
                if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignUpModal === 'function') {
                    irisAuth.showSignUpModal();
                }
            }
        });
    });
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
    if (!sectionId) {
        console.warn("navigateTo called with null or undefined sectionId");
        return;
    }
    
    console.log(`Navigating to section: ${sectionId}`);
    
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
        else if (sectionId === 'performance' && state.sessionId) {
            // If we're navigating to performance, make sure we've loaded the most recent interview
            checkAndUnlockHistorySections(state.sessionId);
        }
        else if (sectionId === 'mock-interview' && !state.videoStream) {
            // No change needed here - keep as is
        }
    } else {
        console.error(`Navigation target element #${sectionId} not found.`);
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
    progressBar.classList.remove('bg-success', 'bg-danger', 'bg-warning'); // Reset colors
    progressMessage.textContent = 'Uploading files...';

    // Disable button during upload
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) analyzeBtn.disabled = true; analyzeBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Analyzing...'; // Add spinner

    fetch(`${API_BASE_URL}/analyze-resume`, {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                if (errData.limitReached) {
                     showMessage(errData.error || 'Usage limit reached.', 'warning');
                     showExistingUpgradeModal('resumeAnalyses');
                     throw new Error('Limit Reached');
                }
                throw new Error(errData.error || `Analysis request failed (${response.status})`);
            }).catch((jsonParseError) => {
                console.error("Could not parse error JSON from backend:", jsonParseError);
                if (jsonParseError.message === 'Limit Reached') {
                    throw jsonParseError;
                }
                throw new Error(`Analysis request failed (${response.status} ${response.statusText})`);
            });
        }
        return response.json();
    })
    .then(data => { // 'data' contains { sessionId, status, message, usageInfo }
        console.log('Upload response:', data); // Log includes usageInfo now
        if (!data.sessionId) {
            throw new Error("Backend did not return a valid session ID.");
        }

        // Set session ID in the global state
        state.sessionId = data.sessionId;
        console.log("Session ID stored in state:", state.sessionId);

        // *** FIX ISSUE 1: Update local usage state from backend response ***
        if (data.usageInfo && typeof irisAuth !== 'undefined' && irisAuth.getUserProfile()?.usage?.resumeAnalyses) {
            // Update local auth state directly
            authState.userProfile.usage.resumeAnalyses.used = data.usageInfo.used;
            authState.userProfile.usage.resumeAnalyses.limit = data.usageInfo.limit; // Ensure limit is also synced if it changes
            console.log("Updated local 'resumeAnalyses' usage state from backend response:", authState.userProfile.usage.resumeAnalyses);
        } else {
             console.warn("Could not update local usage state: usageInfo missing in response or local profile structure invalid.");
             // Consider reloading the profile as a fallback if needed: irisAuth.loadUserProfile(user);
        }
        // *** END FIX ISSUE 1 ***

        // Update usage display with the potentially updated local state
        updateUsageDisplay();

        progressMessage.textContent = 'Analyzing resume...';
        pollAnalysisStatus(data.sessionId); // Start polling backend for analysis progress

        // Note: analyzeBtn state is now handled within pollAnalysisStatus
    })
    .catch(error => {
        console.error('Error initiating resume analysis:', error); // Changed log message

        // Don't show generic error if it was a limit reached error
        if (error.message !== 'Limit Reached') {
             if(progressMessage) progressMessage.textContent = `Error: ${error.message}`;
             if(progressBar) progressBar.classList.add('bg-danger'); progressBar.style.width = '100%';
             showMessage(`Error starting analysis: ${error.message}`, 'danger');
        } else {
             if(progressMessage) progressMessage.textContent = `Limit reached. Please upgrade.`;
             if(progressBar) progressBar.classList.add('bg-warning'); progressBar.style.width = '100%';
        }

        // *** FIX ISSUE 2 (Partial): Re-enable button on *initial* fetch error ***
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = 'Analyze Resume'; // Reset text
        }
    });
}                                    

function pollAnalysisStatus(sessionId) {
    const progressContainer = document.getElementById('uploadProgress');
    const progressBar = progressContainer?.querySelector('.progress-bar');
    const progressMessage = document.getElementById('progressMessage');
    const analyzeBtn = document.getElementById('analyzeBtn'); // Get button reference

    if (!progressContainer || !progressBar || !progressMessage) return; // Exit if elements aren't there

    const checkStatus = () => {
        // If session changed or cleared, stop polling
        if (state.sessionId !== sessionId) {
            console.log("Session changed, stopping polling for", sessionId);
            // *** FIX ISSUE 2: Ensure button is reset if polling stops unexpectedly ***
            if (analyzeBtn) {
                analyzeBtn.disabled = false;
                analyzeBtn.innerHTML = 'Analyze Resume';
            }
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
                checkAndUnlockHistorySections(sessionId); // Check history before unlocking

                // *** FIX ISSUE 2: Reset button on completion ***
                if (analyzeBtn) {
                    analyzeBtn.disabled = false;
                    analyzeBtn.innerHTML = 'Analyze Resume';
                }

                setTimeout(() => {
                    navigateTo('analysis');
                    progressContainer.style.display = 'none'; // Hide progress bar
                }, 1500);

            } else if (statusData.status === 'failed') {
                const errorMsg = statusData.errors?.[0] || 'Analysis failed';
                progressMessage.textContent = `Error: ${errorMsg}`;
                progressBar.classList.add('bg-danger');
                showMessage(`Analysis failed: ${errorMsg}`, 'danger');

                // *** FIX ISSUE 2: Reset button on failure ***
                if (analyzeBtn) {
                    analyzeBtn.disabled = false;
                    analyzeBtn.innerHTML = 'Analyze Resume';
                }

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

             // *** FIX ISSUE 2: Reset button on polling error ***
             if (analyzeBtn) {
                analyzeBtn.disabled = false;
                analyzeBtn.innerHTML = 'Analyze Resume';
            }

            if (error.message.includes('Session not found')) {
                 // Reset relevant UI? Maybe lock sections again.
                 lockAllSections();
                 navigateTo('upload');
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

// New function to load interview data from the progress history
function loadLatestInterviewData(sessionId) {
    console.log(`Attempting to load latest interview data for session: ${sessionId}`);
    
    // First get the progress history which contains interview IDs
    return fetch(`${API_BASE_URL}/get-progress-history/${sessionId}`)
        .then(response => {
            if (!response.ok) {
                if (response.status === 404) {
                    console.log("No interview history found.");
                    return { interviews: [] };
                }
                throw new Error(`Failed to fetch progress history (${response.status})`);
            }
            return response.json();
        })
        .then(historyData => {
            if (!historyData.interviews || historyData.interviews.length === 0) {
                console.log("No interviews found in history.");
                return null;
            }
            
            // Find the most recent interview
            const sortedInterviews = [...historyData.interviews].sort((a, b) => 
                new Date(b.date) - new Date(a.date)
            );
            
            const mostRecentInterview = sortedInterviews[0];
            
            if (!mostRecentInterview.interviewId) {
                console.log("Most recent interview record has no interviewId.");
                return null;
            }
            
            console.log(`Loading interview analysis for ID: ${mostRecentInterview.interviewId}`);
            
            // Fetch the interview analysis using the interviewId
            return fetch(`${API_BASE_URL}/get-interview-analysis/${mostRecentInterview.interviewId}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch interview analysis (${response.status})`);
                    }
                    return response.json();
                })
                .then(analysisData => {
                    console.log('Successfully loaded interview analysis:', analysisData);
                    return analysisData;
                });
        })
        .catch(error => {
            console.error('Error loading interview data:', error);
            return null;
        });
}

// Add this function to be called during initialization
function initializePerformanceSection() {
    if (!state.sessionId) {
        console.log('No session ID available, cannot load interview data');
        return;
    }
    
    console.log(`Initializing performance section for session: ${state.sessionId}`);
    
    // Show loading state in performance section
    const performanceSection = document.getElementById('performance');
    if (performanceSection) {
        performanceSection.innerHTML = `
            <div class="container text-center mt-5">
                <h2>Loading Interview Performance Data...</h2>
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            </div>`;
    }
    
    // Load the latest interview data
    loadLatestInterviewData(state.sessionId)
        .then(analysisData => {
            if (!analysisData) {
                console.log('No interview analysis data available');
                if (performanceSection) {
                    performanceSection.innerHTML = `
                        <div class="container">
                            <h2>Interview Performance Analysis</h2>
                            <p class="section-description">No interview data found. Complete a mock interview to see analysis here.</p>
                        </div>`;
                }
                return;
            }
            
            // Ensure the performance section structure is restored
            restorePerformanceSectionHTML();
            
            // Display the interview analysis data
            displayInterviewAnalysis(analysisData);
            
            // Also load suggested answers if available
            if (analysisData.interviewId) {
                loadSuggestedAnswers(analysisData.interviewId);
            }
            
            // Unlock the performance section
            unlockSection('performance');
        })
        .catch(error => {
            console.error('Error initializing performance section:', error);
            if (performanceSection) {
                performanceSection.innerHTML = `
                    <div class="container">
                        <div class="alert alert-danger">Error loading interview data: ${error.message}</div>
                    </div>`;
            }
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
                // Force explicit styles directly on the video element
                videoElement.style.position = 'absolute';
                videoElement.style.top = '0';
                videoElement.style.left = '0';
                videoElement.style.width = '100%';
                videoElement.style.height = '100%';
                videoElement.style.objectFit = 'cover';
                videoElement.style.backgroundColor = '#000';
                videoElement.style.zIndex = '5';
                videoElement.style.display = 'block';
                videoElement.style.opacity = '1';
                videoElement.style.visibility = 'visible';
                
                // Set stream to video element
                videoElement.srcObject = stream;
                
                // Try to force the video to play after a small delay
                setTimeout(() => {
                    videoElement.play()
                        .then(() => console.log("Video playing successfully"))
                        .catch(err => console.error("Error playing video:", err));
                }, 100);
                
                console.log("Video stream connected to video element");
                
                // Add debug check for video element dimensions
                setTimeout(() => {
                    const rect = videoElement.getBoundingClientRect();
                    console.log("Video element dimensions:", rect.width, "x", rect.height);
                    console.log("Video element position:", rect.top, rect.left);
                    console.log("Video element visibility:", 
                        window.getComputedStyle(videoElement).visibility,
                        window.getComputedStyle(videoElement).display);
                    
                    // Check parent containers too
                    const videoContainer = videoElement.parentElement;
                    if (videoContainer) {
                        const containerRect = videoContainer.getBoundingClientRect();
                        console.log("Video container dimensions:", containerRect.width, "x", containerRect.height);
                    }
                }, 1000);
            } else {
                console.error("candidateVideo element not found in DOM");
            }

            setupMediaRecorder(stream);

            // Fix for potential video container visibility issues
            const videoPanel = document.querySelector('.video-panel');
            if (videoPanel) {
                videoPanel.style.minHeight = '400px';
                videoPanel.style.height = '70vh';
                videoPanel.style.position = 'relative';
                videoPanel.style.backgroundColor = '#1a1a1a';
            }

            const videoContainer = document.querySelector('.video-container');
            if (videoContainer) {
                videoContainer.style.position = 'relative';
                videoContainer.style.width = '100%';
                videoContainer.style.height = '100%';
                videoContainer.style.overflow = 'hidden';
            }

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
    // Feature access checked before calling setupMediaDevices which calls this

    if (!state.sessionId) {
        alert('No active analysis session found. Please analyze a resume first.');
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
    if (conversationContainer) conversationContainer.innerHTML = '';

    addMessageToConversation("system", `Starting ${state.interviewType} interview...`);

    // Show loading/starting state
    // Identify potential buttons that trigger this
    const startBtn1 = document.getElementById('startInterviewBtn');
    const startBtn2 = document.getElementById('startNewInterviewBtn');
    const startBtn3 = document.getElementById('startAnotherInterviewBtn');
    if(startBtn1) { startBtn1.disabled = true; startBtn1.textContent = 'Starting...'; }
    if(startBtn2) { startBtn2.disabled = true; startBtn2.textContent = 'Starting...'; }
    if(startBtn3) { startBtn3.disabled = true; startBtn3.textContent = 'Starting...'; }

    fetch(`${API_BASE_URL}/start-mock-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: state.sessionId,
            interviewType: state.interviewType
        })
    })
    .then(response => {
        if (!response.ok) {
             return response.json().then(errData => {
                if (errData.limitReached) {
                     showMessage(errData.error || 'Usage limit reached.', 'warning');
                     showExistingUpgradeModal('mockInterviews');
                     throw new Error('Limit Reached');
                }
                throw new Error(errData.error || `Failed to start interview (${response.status})`);
            }).catch((jsonParseError) => {
                console.error("Could not parse error JSON from backend:", jsonParseError);
                 if (jsonParseError.message === 'Limit Reached') {
                    throw jsonParseError;
                }
                throw new Error(`Failed to start interview (${response.status} ${response.statusText})`);
            });
        }
        return response.json();
    })
    .then(data => { // data contains { interviewId, sessionId, interviewType, greeting, usageInfo }
        console.log('Interview started response:', data);
        if (!data.interviewId || !data.greeting) {
            throw new Error("Invalid response from start-mock-interview");
        }

        state.interviewId = data.interviewId;

        // *** FIX ISSUE 1: Update local usage state from backend response ***
        if (data.usageInfo && typeof irisAuth !== 'undefined' && irisAuth.getUserProfile()?.usage?.mockInterviews) {
            // Update local auth state directly
            authState.userProfile.usage.mockInterviews.used = data.usageInfo.used;
            authState.userProfile.usage.mockInterviews.limit = data.usageInfo.limit;
            console.log("Updated local 'mockInterviews' usage state from backend response:", authState.userProfile.usage.mockInterviews);
        } else {
             console.warn("Could not update local interview usage state: usageInfo missing in response or local profile structure invalid.");
        }
         // *** END FIX ISSUE 1 ***

        // Update usage display with the potentially updated local state
        updateUsageDisplay();

        // Remove "Starting..." message
        const systemMessages = conversationContainer?.querySelectorAll('.message.system');
        systemMessages?.forEach(msg => msg.remove());

        // Display and speak greeting
        addMessageToConversation('interviewer', data.greeting);
        generateAndPlayTTS(data.greeting); // Triggers listening when done

        // Reset button states (or maybe hide/change function)
        if(startBtn1) { startBtn1.disabled = false; startBtn1.textContent = 'Start Interview'; }
        if(startBtn2) { startBtn2.disabled = false; startBtn2.textContent = 'Start New Interview'; }
        if(startBtn3) { startBtn3.disabled = false; startBtn3.textContent = 'Start Another Interview'; }
        // Consider navigating to the interview screen here if not already done
        // navigateTo('mock-interview');

        return data;
    })
    .catch(error => {
        console.error('Error starting interview:', error);
        state.isInterviewActive = false; // Reset state

         if (error.message !== 'Limit Reached') {
             alert(`Error starting interview: ${error.message}`);
             addMessageToConversation("system", `Error starting interview: ${error.message}. Please try again.`);
         } else {
              addMessageToConversation("system", `Mock interview limit reached. Please upgrade your plan.`);
         }

        // Reset button states on error
        if(startBtn1) { startBtn1.disabled = false; startBtn1.textContent = 'Start Interview'; }
        if(startBtn2) { startBtn2.disabled = false; startBtn2.textContent = 'Start New Interview'; }
        if(startBtn3) { startBtn3.disabled = false; startBtn3.textContent = 'Start Another Interview'; }
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

    // Show loading state
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
        return response.text()  // Get raw text first instead of json()
        .then(text => {
            // Safely parse JSON with error handling
            try {
                return JSON.parse(text);
            } catch(e) {
                console.error("JSON parse error:", e);
                console.error("Raw response text:", text.slice(0, 500) + "...");
                throw new Error(`Failed to parse JSON response: ${e.message}`);
            }
        });
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

// Modify the checkAndUnlockHistorySections function to call loadLatestInterviewData
function checkAndUnlockHistorySections(sessionIdToCheck) {
    if (!sessionIdToCheck) return; // Need a session ID
    
    fetch(`${API_BASE_URL}/get-progress-history/${sessionIdToCheck}`)
        .then(res => {
            if (!res.ok) {
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
                
                // Load the interview data and display it
                loadLatestInterviewData(sessionIdToCheck)
                    .then(analysisData => {
                        if (analysisData) {
                            restorePerformanceSectionHTML();
                            displayInterviewAnalysis(analysisData);
                            
                            if (analysisData.interviewId) {
                                loadSuggestedAnswers(analysisData.interviewId);
                            }
                        }
                    })
                    .catch(err => {
                        console.error('Error loading interview analysis in checkAndUnlockHistorySections:', err);
                    });
            } else {
                console.log(`No interview history found for session ${sessionIdToCheck}. Keeping performance/history locked.`);
                lockSection('performance');
                lockSection('history');
            }
        })
        .catch(err => {
            console.error(`Error checking history for session ${sessionIdToCheck}:`, err);
            lockSection('performance');
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
            showExistingUpgradeModal(featureType);
            return false;
        }
    }
    
    return true;
}

// Helper function to get user-friendly feature name
function getFeatureDisplayName(featureType) {
    const displayNames = {
        'resumeAnalyses': 'resume analysis',
        'mockInterviews': 'mock interview',
        'pdfDownloads': 'PDF download',
        'aiEnhance': 'AI enhancement'
    };
    return displayNames[featureType] || featureType;
}

// --- New function to update usage display ---
function updateUsageDisplay() {

    // Check if irisAuth is defined
    if (typeof irisAuth === 'undefined') {
        console.warn('irisAuth not available, cannot update usage display');
        return;
    }

    const userProfile = irisAuth?.getUserProfile();
    if (!userProfile || !userProfile.usage) return;

    // Resume analyses usage
    updateFeatureUsageDisplay('resumeAnalyses', userProfile.usage.resumeAnalyses);
    
    // Mock interviews usage
    updateFeatureUsageDisplay('mockInterviews', userProfile.usage.mockInterviews);
    
    // PDF downloads usage (new)
    updateFeatureUsageDisplay('pdfDownloads', userProfile.usage.pdfDownloads);
    
    // AI enhance usage (new)
    updateFeatureUsageDisplay('aiEnhance', userProfile.usage.aiEnhance);
    
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

function showExistingUpgradeModal(featureType) {
    // First clean up any existing modals
    safelyCloseModal('upgradeModal');
    safelyCloseModal('paymentProcessingModal');
    safelyCloseModal('paymentSuccessModal');
    safelyCloseModal('limitReachedModal');
    
    // Get current plan to determine what plans to highlight
    const currentPlan = irisAuth?.getUserProfile()?.plan || 'free';
    
    // Remove any existing upgrade modal from the DOM
    const existingModal = document.getElementById('upgradeModal');
    if (existingModal) {
        existingModal.remove();
    }
    
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
    
    // Create the modal element with a special class for tracking
    const modalDiv = document.createElement('div');
    modalDiv.className = 'modal fade dynamic-modal'; // Add custom class for cleanup
    modalDiv.id = 'upgradeModal';
    modalDiv.tabIndex = '-1';
    modalDiv.setAttribute('aria-hidden', 'true');
    
    // Build the modal HTML structure
    modalDiv.innerHTML = `
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">${heading}</h5>
                    <button type="button" class="btn-close close-upgrade-modal" aria-label="Close"></button>
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
                                        <li><i class="fas fa-check text-success me-2"></i> <strong>20 Resume Analyses</strong></li>
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
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary close-upgrade-modal">Close</button>
                </div>
            </div>
        </div>
    `;
    
    // Append the modal to the document body
    document.body.appendChild(modalDiv);
    
    // Initialize Bootstrap modal with specific options
    const upgradeModal = new bootstrap.Modal(modalDiv, {
        backdrop: true,
        keyboard: true, // Allow ESC key to close
        focus: true
    });
    
    // Show the modal
    upgradeModal.show();
    
    // Add event listeners to plan select buttons
    document.querySelectorAll('.plan-select-btn').forEach(button => {
        button.addEventListener('click', function() {
            const planName = this.getAttribute('data-plan');
            
            // First hide the modal properly
            upgradeModal.hide();
            
            // Remove modal and continue with plan selection after animation completes
            modalDiv.addEventListener('hidden.bs.modal', function() {
                // Force cleanup after modal hide animation
                setTimeout(() => {
                    safelyCloseModal('upgradeModal');
                    // Call selectPlan function with the selected plan
                    selectPlanFixed(planName);
                }, 150);
            }, { once: true }); // Use once to prevent multiple handlers
        });
    });
    
    // Add special handling for close buttons
    document.querySelectorAll('.close-upgrade-modal').forEach(button => {
        button.addEventListener('click', function() {
            upgradeModal.hide();
            
            // Ensure modal gets removed after hiding
            setTimeout(() => {
                safelyCloseModal('upgradeModal');
            }, 300);
        });
    });
    
    // Handle modal hidden event for proper cleanup
    modalDiv.addEventListener('hidden.bs.modal', function() {
        // Wait for animation to complete, then remove from DOM
        setTimeout(() => {
            // Remove the element from the DOM
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
            
            // Double-check for any lingering backdrop
            document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                backdrop.remove();
            });
            
            // Ensure body doesn't remain in modal state
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('padding-right');
            document.body.style.removeProperty('overflow');
        }, 300);
    }, { once: true });
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

// Replace the existing toggleFullscreen function in app.js
function toggleFullscreen() {
    // Target the video panel which includes the container and footer
    const videoPanel = document.querySelector('.video-panel');
    if (!videoPanel) return;
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const icon = fullscreenBtn?.querySelector('i');

    if (!document.fullscreenElement &&
        !document.webkitFullscreenElement && // Safari
        !document.msFullscreenElement) {     // IE11
        // Enter fullscreen
        if (videoPanel.requestFullscreen) {
            videoPanel.requestFullscreen();
        } else if (videoPanel.webkitRequestFullscreen) { /* Safari */
            videoPanel.webkitRequestFullscreen();
        } else if (videoPanel.msRequestFullscreen) { /* IE11 */
            videoPanel.msRequestFullscreen();
        }
        if (icon) icon.className = 'fas fa-compress';
        videoPanel.classList.add('fullscreen'); // Add class to panel
    } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { /* Safari */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { /* IE11 */
            document.msExitFullscreen();
        }
         if (icon) icon.className = 'fas fa-expand';
         videoPanel.classList.remove('fullscreen'); // Remove class from panel
    }
}

// Add a listener to handle fullscreen change
document.addEventListener('fullscreenchange', updateFullscreenButtonState);
document.addEventListener('webkitfullscreenchange', updateFullscreenButtonState);
document.addEventListener('mozfullscreenchange', updateFullscreenButtonState);
document.addEventListener('MSFullscreenChange', updateFullscreenButtonState);

// Modify updateFullscreenButtonState to check the panel class as well
function updateFullscreenButtonState() {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const icon = fullscreenBtn?.querySelector('i');
    const videoPanel = document.querySelector('.video-panel'); // Check the panel
    if (!icon) return;

    // Check both document state AND the panel's class for robustness
    if (document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement) {
        icon.className = 'fas fa-compress';
        videoPanel?.classList.add('fullscreen'); // Ensure class is added
    } else {
        icon.className = 'fas fa-expand';
        videoPanel?.classList.remove('fullscreen'); // Ensure class is removed
    }
}

// Keep track of unique IDs for dynamic items
let experienceCounter = 0;
let educationCounter = 0;
let projectCounter = 0;

// Function to initialize resume builder listeners (call when navigating to it)
function initResumeBuilder() {
    console.log("Initializing Resume Builder Listeners (with Live Preview)...");
    const resumeBuilderSection = document.getElementById('resume-builder');
    const editorPane = resumeBuilderSection?.querySelector('.resume-editor-pane'); // Target editor pane

    if (!resumeBuilderSection || !editorPane) {
        console.error("Resume builder section or editor pane not found.");
        return;
    }

    // --- Event Listener Setup ---
    // Use event delegation on the editor pane for input changes
    if (!editorPane.dataset.inputListenerAttached) {
        const debouncedUpdate = debounce(updateResumePreview, 300); // Update preview 300ms after last input
        editorPane.addEventListener('input', (event) => {
            // Listen for changes in inputs, textareas, selects
            if (event.target.matches('input, textarea, select')) {
                debouncedUpdate();
            }
        });
        editorPane.dataset.inputListenerAttached = 'true';
        console.log("Input listener attached to editor pane.");
    }

    // Add/Remove Item Buttons (using delegation, now also triggers preview update)
    if (!editorPane.dataset.addItemListenerAttached) {
         editorPane.addEventListener('click', function(event){
             const addButton = event.target.closest('.add-item-btn');
             const removeButton = event.target.closest('.remove-item-btn');
             if (addButton) {
                 handleAddItem(event);
                 updateResumePreview(); // Update preview immediately after adding
             } else if (removeButton) {
                 handleRemoveItem(removeButton); // Pass the button to handleRemoveItem
                 updateResumePreview(); // Update preview immediately after removing
             }
         });
         editorPane.dataset.addItemListenerAttached = 'true';
         console.log("Add/Remove item listeners attached.");
    }

    // AI Generate Buttons (already delegated, no preview update needed here)
    if (!editorPane.dataset.aiListenerAttached) {
         setupAIGenerateListener(editorPane); // Pass editorPane instead of whole section
         console.log("AI listener attached.");
    }


    // Section Hide/Show Buttons (now also triggers preview update)
     if (!editorPane.dataset.toggleListenerAttached) {
        editorPane.addEventListener('click', function(event) {
            const button = event.target.closest('.hide-section-btn, .show-section-btn');
            if (button) {
                handleToggleSection(button);
                updateResumePreview(); // Update preview after toggling
            }
        });
        editorPane.dataset.toggleListenerAttached = 'true';
        console.log("Section toggle listener attached.");
     }

    // Settings Controls (Listen for changes)
    const settingsContainer = editorPane.querySelector('.resume-settings-container');
    if (settingsContainer) {
         settingsContainer.querySelectorAll('select, input[type="radio"]').forEach(control => {
              if (!control.dataset.listenerAttached) {
                 // *** CHANGE HERE ***
                 control.addEventListener('change', () => {
                     applyResumeStyles();   // Apply the style to the container
                     updateResumePreview(); // Re-render the content
                 });
                 // *** END CHANGE ***
                 control.dataset.listenerAttached = 'true';
              }
         });
          console.log("Settings listeners attached.");
    }

    // --- Spacing controls ---
    const spacingFactorSlider = document.getElementById('resumeSpacingFactor');
    const sectionSpacingSlider = document.getElementById('sectionSpacing');
    const itemSpacingSlider = document.getElementById('itemSpacing');

    const spacingFactorValue = document.getElementById('spacingFactorValue');
    const sectionSpacingValue = document.getElementById('sectionSpacingValue');
    const itemSpacingValue = document.getElementById('itemSpacingValue');

    // Initialize spacing sliders if they exist
    if (spacingFactorSlider && spacingFactorValue) {
        spacingFactorSlider.addEventListener('input', function() {
            spacingFactorValue.textContent = `${this.value}×`;
            updateResumePreview(); // Update preview when spacing changes
        });
    }

    if (sectionSpacingSlider && sectionSpacingValue) {
        sectionSpacingSlider.addEventListener('input', function() {
            sectionSpacingValue.textContent = `${this.value}×`;
            updateResumePreview(); // Update preview when spacing changes
        });
    }

    if (itemSpacingSlider && itemSpacingValue) {
        itemSpacingSlider.addEventListener('input', function() {
            itemSpacingValue.textContent = `${this.value}×`;
            updateResumePreview(); // Update preview when spacing changes
        });
    }

    // Download Button - Modified to use the original click handler
    const downloadBtn = document.getElementById('downloadResumeBtn');
    if (downloadBtn) {
        // Remove any existing click handler
        const newDownloadBtn = downloadBtn.cloneNode(true);
        downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
        
        // Add the new handler with usage tracking
        newDownloadBtn.addEventListener('click', downloadResumePDF);
    }

    // Apply initial styles and render preview
    applyResumeStyles();
    updateResumePreview();
    
    // NEW: Update usage UI to display remaining usage
    updateResumeBuilderUsageUI();
    
    console.log("Resume builder initialized with usage tracking.");
}

// --- Ensure handleRemoveItem uses the passed button ---
function handleRemoveItem(button) { // Modify signature
    const itemToRemove = button.closest('.resume-item');
    if (itemToRemove) {
        itemToRemove.remove();
    }
}

// Function to attach AI Generate listener using delegation
function setupAIGenerateListener(container) {
    if (container.dataset.aiListenerAttached) return; // Prevent duplicates
    container.addEventListener('click', function(event) {
        const button = event.target.closest('.ai-generate-btn');
        if (button) {
            const targetId = button.dataset.target;
            const sectionType = button.dataset.type;
            let contentElement;

            // Find the target element relative to the button
             if (targetId === 'resumeObjective' || targetId === 'resumeSkills') {
                contentElement = document.getElementById(targetId);
             } else {
                // For items within templates (Experience, Project descriptions)
                const itemCard = button.closest('.resume-item');
                if (itemCard) {
                    contentElement = itemCard.querySelector(`[data-field="${targetId}"]`);
                }
             }


            if (contentElement) {
                enhanceResumeContent(sectionType, contentElement, button);
            } else {
                 console.error("Target content element not found for AI Generate:", targetId);
                 showErrorMessage("Could not find the content field to enhance.", "warning");
            }
        }
    });
    container.dataset.aiListenerAttached = 'true';
}

 // Function to attach Remove Item listener using delegation
function setupRemoveItemListener(containerId) {
    const container = document.getElementById(containerId);
    if (!container || container.dataset.removeListenerAttached) return;
    container.addEventListener('click', function(event) {
         const button = event.target.closest('.remove-item-btn');
         if (button) {
             handleRemoveItem(button);
         }
    });
    container.dataset.removeListenerAttached = 'true';
}

 // Function to attach Section Toggle listener using delegation
function setupSectionToggleListener(container) {
    if (container.dataset.toggleListenerAttached) return;
    container.addEventListener('click', function(event) {
         const button = event.target.closest('.hide-section-btn, .show-section-btn');
         if (button) {
             handleToggleSection(button);
         }
    });
    container.dataset.toggleListenerAttached = 'true';
}


// Add new item (Experience, Education, Project)
function handleAddItem(event) {
    const targetContainerId = event.target.dataset.target;
    const templateId = event.target.dataset.template;
    const targetContainer = document.getElementById(targetContainerId);
    const template = document.getElementById(templateId);

    if (!targetContainer || !template) {
        console.error("Target container or template not found for add item.");
        return;
    }

    const newItem = template.cloneNode(true);
    newItem.id = ''; // Remove template ID from clone
    newItem.classList.remove('d-none'); // Make it visible

     // Assign unique IDs to inputs/textareas within the cloned item if needed
    let counter;
    if (templateId === 'experienceTemplate') counter = ++experienceCounter;
    else if (templateId === 'educationTemplate') counter = ++educationCounter;
    else if (templateId === 'projectTemplate') counter = ++projectCounter;
    else counter = Date.now(); // Fallback

    newItem.querySelectorAll('input, textarea').forEach(el => {
         if(el.id) el.id = `<span class="math-inline">\{el\.id\}\-</span>{counter}`;
         const label = newItem.querySelector(`label[for="${el.id.replace(`-${counter}`, '')}"]`);
         if(label) label.setAttribute('for', el.id);
         // Find the AI button targeting this element
         const aiButton = newItem.querySelector(`.ai-generate-btn[data-target="${el.dataset.field}"]`);
         if(aiButton) {
             // Set a more specific target reference, perhaps using the counter
             // For now, the relative search in setupAIGenerateListener should work
         }
    });


    targetContainer.appendChild(newItem);
}


// Toggle Section Visibility
function handleToggleSection(button) {
     const section = button.closest('.resume-section');
     if (!section) return;

     const isHidden = section.classList.toggle('hidden');
     button.classList.toggle('hide-section-btn', !isHidden);
     button.classList.toggle('show-section-btn', isHidden);
     button.innerHTML = isHidden ? '<i class="fas fa-eye"></i> Show' : '<i class="fas fa-eye-slash"></i> Hide';
     button.title = isHidden ? 'Show Section' : 'Hide Section';
}


// Apply Font, Size, and Document Type Styles to Preview Container
function applyResumeStyles() {
    const fontFamily = document.getElementById('resumeFontFamily')?.value || "'Helvetica', 'Arial', sans-serif"; 
    const fontSizeOption = document.querySelector('input[name="resumeFontSize"]:checked')?.value || 'standard';
    const docSizeOption = document.querySelector('input[name="resumeDocSize"]:checked')?.value || 'letter';

    const previewArea = document.getElementById('resumePreviewArea');
    if(previewArea) {
        // Apply font family via style attribute for dynamic change
        previewArea.style.fontFamily = fontFamily;

        // Apply font size class
        previewArea.classList.remove('font-compact', 'font-standard', 'font-large');
        previewArea.classList.add(`font-${fontSizeOption}`);
        
        // Apply document size settings
        previewArea.setAttribute('data-doc-size', docSizeOption);
        
        // Apply actual dimensions that approximate paper sizes
        if (docSizeOption === 'letter') {
            // Letter dimensions (maintaining aspect ratio with max-width constraint)
            previewArea.style.maxWidth = '100%'; // Use container constraints
            previewArea.style.aspectRatio = '8.5/11'; // Standard US Letter ratio
        } else if (docSizeOption === 'a4') {
            // A4 dimensions (maintaining aspect ratio with max-width constraint)
            previewArea.style.maxWidth = '100%'; // Use container constraints
            previewArea.style.aspectRatio = '1/1.414'; // Standard A4 ratio (approximately 1:1.414)
        }
        
        console.log(`Applied styles to preview container: Font=${fontFamily}, Size Class=font-${fontSizeOption}, Document Size=${docSizeOption}`);
    }
    // DO NOT call updateResumePreview() here
}

// AI Content Enhancement
async function enhanceResumeContent(sectionType, contentElement, button) {
    // First, check if user can use AI enhance
    if (!trackAiEnhance()) {
        return; // Stop if limit is reached or user not logged in
    }

    const originalContent = contentElement.value.trim();

    if (!originalContent) {
        showErrorMessage('Please enter some content before using AI Enhance.', 'warning');
        return;
    }

    // Disable button and show loading state
    button.disabled = true;
    const originalButtonText = button.innerHTML;
    button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Enhancing...';
    showToast('✨ Enhancing your content with AI...');

    try {
        const response = await fetch(`${API_BASE_URL}/enhance-resume-content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add Auth headers if your backend requires them
                // 'Authorization': `Bearer ${await firebase.auth().currentUser.getIdToken()}`
            },
            body: JSON.stringify({
                sectionType: sectionType,
                originalContent: originalContent
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Network error or invalid JSON response' }));
            throw new Error(errorData.error || `Failed to enhance content (${response.status})`);
        }

        const data = await response.json();

        if (data.enhancedContent) {
            contentElement.value = data.enhancedContent; // Update the input/textarea
            showToast('✅ Content enhanced successfully!', 'success');
            // Trigger input event for potential frameworks that listen to changes
            contentElement.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            throw new Error(data.error || "Enhancement failed: No content returned.");
        }

    } catch (error) {
        console.error('Error enhancing resume content:', error);
        showErrorMessage(`AI Enhancement Error: ${error.message}`, 'danger');
        showToast(`❌ Enhancement failed: ${error.message}`, 'danger');
    } finally {
        // Re-enable button and restore text
        button.disabled = false;
        button.innerHTML = originalButtonText;
    }
}

// Function to display simple toast messages (replace with your preferred library if any)
function showToast(message, type = 'info', duration = 3000) {
     const toastContainer = document.getElementById('error-messages'); // Reuse error container
     if (!toastContainer) {
         console.log("Toast:", message); // Fallback log
         return;
     }

     const toastId = `toast-${Date.now()}`;
     const toast = document.createElement('div');
     toast.id = toastId;
     // Use Bootstrap toast classes slightly adapted for the alert container
     toast.className = `alert alert-${type} alert-dismissible fade show mb-2`;
     toast.setAttribute('role', 'alert');
     toast.setAttribute('aria-live', 'assertive');
     toast.setAttribute('aria-atomic', 'true');

     toast.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
     `;

     toastContainer.appendChild(toast);

     // Auto-dismiss
     setTimeout(() => {
        const currentToast = document.getElementById(toastId);
        if (currentToast) {
            currentToast.classList.remove('show');
            // Wait for fade out animation before removing
            setTimeout(() => currentToast.remove(), 500);
        }
     }, duration);
}


// Gather Resume Data (Corrected to include Certifications)
function getResumeData() {
    const data = {
        personal: {
            name: document.getElementById('resumeName')?.value || '',
            location: document.getElementById('resumeLocation')?.value || '',
            phone: document.getElementById('resumePhone')?.value || '',
            email: document.getElementById('resumeEmail')?.value || '',
            website: document.getElementById('resumeWebsite')?.value || ''
        },
        objective: document.getElementById('resumeObjective')?.value || '',
        experience: [],
        education: [],
        projects: [],
        skills: document.getElementById('resumeSkills')?.value || '',
        // --- ADDED THIS LINE ---
        certifications: [],
        // --- END ADDED LINE ---
        settings: {
            fontFamily: document.getElementById('resumeFontFamily')?.value || "'Helvetica', 'Arial', sans-serif",
            fontSize: document.querySelector('input[name="resumeFontSize"]:checked')?.value || 'standard',
            docSize: document.querySelector('input[name="resumeDocSize"]:checked')?.value || 'letter',
            spacingFactor: parseFloat(document.getElementById('resumeSpacingFactor')?.value || '1.0'),
            sectionSpacing: parseFloat(document.getElementById('sectionSpacing')?.value || '1.0'),
            itemSpacing: parseFloat(document.getElementById('itemSpacing')?.value || '1.0')
        }
    };

    // Helper to extract data from item containers
    const extractItems = (containerId) => {
        const items = [];
        const container = document.getElementById(containerId); // Get container first
        if (!container) {
             console.warn(`Container element with ID '${containerId}' not found during data extraction.`);
             return items; // Return empty if container missing
        }
        container.querySelectorAll('.resume-item').forEach(itemEl => {
            const itemData = {};
            itemEl.querySelectorAll('input[data-field], textarea[data-field]').forEach(field => {
                // Ensure data-field attribute exists before trying to access dataset
                 if (field.dataset && field.dataset.field) {
                     itemData[field.dataset.field] = field.value;
                 } else {
                     console.warn("Element missing data-field attribute:", field);
                 }
            });
             // Check if itemData has any actual content before pushing
             if (Object.keys(itemData).some(key => itemData[key]?.trim() !== '')) {
                items.push(itemData);
             }
        });
        return items;
    };

    data.experience = extractItems('experienceItems');
    data.education = extractItems('educationItems');
    data.projects = extractItems('projectItems');
    // --- ADDED THIS LINE ---
    data.certifications = extractItems('certificationItems');
    // --- END ADDED LINE ---
    // Note: Skills are taken directly above, not using extractItems

    // Filter out hidden sections
    document.querySelectorAll('#resume-builder .resume-section.hidden').forEach(hiddenSection => {
         const sectionKey = hiddenSection.dataset.section;
         if (data.hasOwnProperty(sectionKey)) {
             // For simplicity, let's just remove the data for preview/PDF generation
             // If you needed to know it was hidden later, you could use:
             // data.settings[`hide_${sectionKey}`] = true;
             delete data[sectionKey];
         }
    });

    console.log("Collected Resume Data:", data); // Add log to see collected data
    return data;
}

function downloadResumePDF() {
    // First, check if user can download PDF
    if (!trackPdfDownload()) {
        return; // Stop if limit is reached or user not logged in
    }

    // Check if jsPDF library is loaded
    if (typeof jspdf === 'undefined') {
        showErrorMessage('PDF generation library (jsPDF) is not loaded.', 'danger');
        console.error("jsPDF is not defined. Make sure the library is included.");
        return;
    }
    
    const { jsPDF } = jspdf; // Destructure jsPDF
    const resumeData = getResumeData(); // Get data from the form
    const docSize = resumeData.settings.docSize || 'letter'; // 'letter' or 'a4'

    // --- Document Setup ---
    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt', // Use points for consistency with font sizes
        format: docSize
    });

    // --- Get Spacing Settings ---
    const spacingFactor = resumeData.settings.spacingFactor || 1.0; // Default if not set
    const sectionSpacing = resumeData.settings.sectionSpacing || 1.0; // Default if not set
    const itemSpacing = resumeData.settings.itemSpacing || 1.0; // Default if not set
    
    console.log(`PDF Generation with spacing: Overall=${spacingFactor}, Sections=${sectionSpacing}, Items=${itemSpacing}`);

    // --- Margins and Page Dimensions ---
    const pageHeight = pdf.internal.pageSize.getHeight();
    const pageWidth = pdf.internal.pageSize.getWidth();
    
    // Adjust margins based on page aspect ratio and spacing
    const margin = 36; // Base margin
    const contentWidth = pageWidth - (2 * margin);
    let currentY = margin; // Start drawing from top margin

    // --- Font Settings ---
    // Determine font sizes based on user selection
    const baseFontSize = resumeData.settings.fontSize === 'compact' ? 9 : 
                          (resumeData.settings.fontSize === 'large' ? 11 : 10);
    const headingFontSize = baseFontSize + 4; // e.g., 14pt for standard
    const subHeadingFontSize = baseFontSize + 1; // e.g., 11pt for standard
    const bodyFontSize = baseFontSize; // e.g., 10pt for standard

    // Use standard PDF fonts (Helvetica is generally available)
    const standardFont = 'Helvetica';
    pdf.setFont(standardFont); // Set default font

    // --- Helper Functions ---

    // Helper to add text that wraps within the content width
    const addWrappedText = (text, x, y, maxWidth, options = {}) => {
        const { fontSize = bodyFontSize, style = 'normal', align = 'left', lineHeightFactor = 1.15 } = options;
        pdf.setFontSize(fontSize);
        pdf.setFont(standardFont, style); // Set style (normal, bold, italic)
        const lines = pdf.splitTextToSize(text || '', maxWidth); // Split text to fit width
        pdf.text(lines, x, y, { align: align, lineHeightFactor: lineHeightFactor });
        // Return adjusted Y position with spacing factor
        return y + (lines.length * fontSize * lineHeightFactor * spacingFactor);
    };

    // Helper to check if a page break is needed before adding content
    const checkAddPage = (requiredHeight) => {
        if (currentY + requiredHeight > pageHeight - margin) { // Check if content exceeds bottom margin
            pdf.addPage(); // Add a new page
            currentY = margin; // Reset Y position to top margin
            return true; // Page was added
        }
        return false; // No page added
    };

    // Helper to add a standard section heading with an underline
    const addSectionHeading = (text) => {
        // Don't add heading if the corresponding section data was deleted (because it was hidden in the editor)
        const sectionKey = text.toLowerCase().replace(/\s+/g, '');
        if (!resumeData[sectionKey] && 
            !['workexperience', 'education', 'projects', 'skills', 'certifications'].includes(sectionKey)) {
            console.log(`Skipping hidden section heading: ${text}`);
            return false; // Indicate that heading was skipped
        }

        // Add extra section spacing (multiplied by the section spacing factor)
        if (currentY > margin + 10) {
            currentY += 12 * sectionSpacing; // Add section spacing before heading (if not the first section)
        }

        checkAddPage(headingFontSize + 15); // Check space for heading and line
        pdf.setFontSize(headingFontSize);
        pdf.setFont(standardFont, 'bold');
        pdf.text(text.toUpperCase(), margin, currentY); // Add heading text in uppercase
        currentY += headingFontSize * 0.6; // Move down slightly for underline
        pdf.setLineWidth(0.5); // Set line thickness
        pdf.line(margin, currentY, pageWidth - margin, currentY); // Draw the underline
        currentY += 10 * spacingFactor; // Add space after the line with spacing factor
        return true; // Indicate heading was added
    };

    // Calculate page distribution based on content and spacing
    const calculateDistribution = () => {
        // Get total available space on page
        const availableSpace = pageHeight - (2 * margin);
        
        // Estimate minimum needed space (can be refined for better distribution)
        let estimatedContentHeight = 0;
        
        // Personal info section
        if (resumeData.personal?.name) {
            estimatedContentHeight += (headingFontSize + 4) * 1.2; // Name
            estimatedContentHeight += bodyFontSize * 1.5; // Contact info
        }
        
        // Objective section
        if (resumeData.objective) {
            const lines = pdf.splitTextToSize(resumeData.objective, contentWidth);
            estimatedContentHeight += lines.length * bodyFontSize * 1.2;
            estimatedContentHeight += 20 * sectionSpacing; // Section gap
        }
        
        // Work Experience section
        if (resumeData.experience?.length > 0) {
            estimatedContentHeight += 30 * sectionSpacing; // Section heading + gap
            resumeData.experience.forEach(exp => {
                estimatedContentHeight += subHeadingFontSize * 2; // Title + company
                const descLines = exp.description?.split('\n') || [];
                estimatedContentHeight += descLines.length * bodyFontSize * 1.2;
                estimatedContentHeight += 15 * itemSpacing; // Item spacing
            });
        }
        
        // Education section
        if (resumeData.education?.length > 0) {
            estimatedContentHeight += 30 * sectionSpacing; // Section heading + gap
            resumeData.education.forEach(edu => {
                estimatedContentHeight += subHeadingFontSize * 2; // Degree + school
                estimatedContentHeight += 15 * itemSpacing; // Item spacing
            });
        }
        
        // Projects section
        if (resumeData.projects?.length > 0) {
            estimatedContentHeight += 30 * sectionSpacing; // Section heading + gap
            resumeData.projects.forEach(proj => {
                estimatedContentHeight += subHeadingFontSize * 1.5; // Project name
                const descLines = proj.description?.split('\n') || [];
                estimatedContentHeight += descLines.length * bodyFontSize * 1.2;
                estimatedContentHeight += 15 * itemSpacing; // Item spacing
            });
        }
        
        // Skills section
        if (resumeData.skills) {
            estimatedContentHeight += 30 * sectionSpacing; // Section heading + gap
            const skillsLines = pdf.splitTextToSize(resumeData.skills, contentWidth);
            estimatedContentHeight += skillsLines.length * bodyFontSize * 1.2;
        }
        
        // Certifications section
        if (resumeData.certifications?.length > 0) {
            estimatedContentHeight += 30 * sectionSpacing; // Section heading + gap
            estimatedContentHeight += resumeData.certifications.length * bodyFontSize * 2;
        }
        
        // Calculate distribution factor based on content and available space
        const distributionFactor = Math.max(1.0, availableSpace / (estimatedContentHeight * spacingFactor));
        
        // Limit the factor to a reasonable range to prevent excessive spacing
        return Math.min(distributionFactor, 1.5);
    };
    
    // Calculate distribution factor once
    const distributionFactor = calculateDistribution();
    console.log(`Calculated distribution factor: ${distributionFactor}`);

    // --- 1. Header Section ---
    if (resumeData.personal?.name) {
        checkAddPage(headingFontSize + 4 + bodyFontSize * 1.5); // Estimate height needed
        pdf.setFontSize(headingFontSize + 4); // Larger font for name
        pdf.setFont(standardFont, 'bold');
        pdf.text(resumeData.personal.name, pageWidth / 2, currentY, { align: 'center' }); // Center align name
        currentY += (headingFontSize + 4) * 1.05 * spacingFactor; // Move Y down with spacing factor
    }
    
    // Construct contact info string, filtering out empty values
    let contactInfo = [
        resumeData.personal?.location,
        resumeData.personal?.phone,
        resumeData.personal?.email,
        resumeData.personal?.website
    ].filter(Boolean).join(' | '); // Join with separators

    if (contactInfo) {
        pdf.setFontSize(bodyFontSize);
        pdf.setFont(standardFont, 'normal');
        pdf.text(contactInfo, pageWidth / 2, currentY, { align: 'center' }); // Center align contact info
        currentY += bodyFontSize * 1.4 * spacingFactor; // Add space after contact info with spacing factor
    }

    // --- 2. Objective/Summary Section ---
    if (resumeData.objective) {
        checkAddPage(bodyFontSize * 3); // Estimate height
        // No heading for summary, just add the text, potentially italicized
        currentY = addWrappedText(resumeData.objective, margin, currentY, contentWidth, { style: 'italic' });
        currentY += bodyFontSize * 0.7 * spacingFactor * sectionSpacing; // Add space after summary with section spacing
    }

    // --- 3. Work Experience Section ---
    if (resumeData.experience && resumeData.experience.length > 0) {
        if (addSectionHeading('Work Experience')) { // Only proceed if heading was added (section not hidden)
            resumeData.experience.forEach((exp, index) => {
                // Add item spacing between experiences
                if (index > 0) {
                    currentY += bodyFontSize * 0.4 * itemSpacing;
                }
                
                checkAddPage(subHeadingFontSize * 2 + bodyFontSize * 3); // Estimate space needed
                pdf.setFontSize(subHeadingFontSize);
                pdf.setFont(standardFont, 'bold');
                // Add Job Title (left aligned)
                pdf.text(exp.jobTitle || 'Job Title', margin, currentY);
                
                // Add Date Range (right aligned)
                if (exp.date) {
                    pdf.setFont(standardFont, 'normal');
                    pdf.text(exp.date, pageWidth - margin, currentY, { align: 'right' });
                }
                currentY += subHeadingFontSize * 1.05 * spacingFactor; // Move Y down with spacing factor

                // Add Company & Location (italicized)
                pdf.setFontSize(bodyFontSize);
                pdf.setFont(standardFont, 'italic');
                pdf.text(`${exp.company || 'Company'} | ${exp.location || 'Location'}`, margin, currentY);
                currentY += bodyFontSize * 1.1 * spacingFactor; // Move Y down with spacing factor

                // Add Description (as bullet points)
                if (exp.description) {
                    const descLines = exp.description.split('\n').map(line => line.trim()).filter(line => line);
                    descLines.forEach((line, i) => {
                        const cleanLine = line.replace(/^[\*\-\•]\s*/, ''); // Remove leading bullet characters
                        
                        // Check for page break, but only if not the first line
                        if (i > 0) {
                            checkAddPage(bodyFontSize * 1.2);
                        }
                        
                        pdf.setFontSize(bodyFontSize);
                        pdf.setFont(standardFont, 'normal');
                        pdf.text('•', margin + 3, currentY); // Draw bullet point
                        
                        // Add the wrapped text line, indented
                        currentY = addWrappedText(cleanLine, margin + 12, currentY, contentWidth - 12);
                    });
                }
                
                // Add spacing after each experience item (except last) based on item spacing
                if (index < resumeData.experience.length - 1) {
                    currentY += bodyFontSize * 0.5 * itemSpacing;
                }
            });
            
            // Add spacing after the section
            currentY += bodyFontSize * 0.5 * sectionSpacing;
        }
    }

    // --- 4. Education Section ---
    if (resumeData.education && resumeData.education.length > 0) {
        if (addSectionHeading('Education')) {
            resumeData.education.forEach((edu, index) => {
                // Add item spacing between education items
                if (index > 0) {
                    currentY += bodyFontSize * 0.4 * itemSpacing;
                }
                
                checkAddPage(subHeadingFontSize * 2 + bodyFontSize * 2);
                pdf.setFontSize(subHeadingFontSize);
                pdf.setFont(standardFont, 'bold');
                // Add Degree/Major (left aligned)
                pdf.text(edu.degreeMajor || 'Degree/Major', margin, currentY);
                
                // Add Graduation Date (right aligned)
                if (edu.date) {
                    pdf.setFont(standardFont, 'normal');
                    pdf.text(edu.date, pageWidth - margin, currentY, { align: 'right' });
                }
                currentY += subHeadingFontSize * 1.05 * spacingFactor; // Move Y down with spacing factor

                // Add School, Location, GPA (italicized)
                pdf.setFontSize(bodyFontSize);
                pdf.setFont(standardFont, 'italic');
                let schoolLine = `${edu.school || 'School'} | ${edu.location || 'Location'}`;
                if (edu.gpa) {
                    schoolLine += ` | GPA: ${edu.gpa}`;
                }
                pdf.text(schoolLine, margin, currentY);
                currentY += bodyFontSize * 1.1 * spacingFactor; // Move Y down with spacing factor

                // Add Additional Info if present
                if (edu.additionalInfo) {
                    currentY = addWrappedText(`Relevant Info: ${edu.additionalInfo}`, margin, currentY, contentWidth, { 
                        style: 'italic', 
                        fontSize: bodyFontSize - 1 
                    });
                }
                
                // Add spacing after each education item
                if (index < resumeData.education.length - 1) {
                    currentY += bodyFontSize * 0.4 * itemSpacing;
                }
            });
            
            // Add spacing after the section
            currentY += bodyFontSize * 0.5 * sectionSpacing;
        }
    }

    // --- 5. Projects Section ---
    if (resumeData.projects && resumeData.projects.length > 0) {
        if (addSectionHeading('Projects')) {
            resumeData.projects.forEach((proj, index) => {
                // Add item spacing between projects
                if (index > 0) {
                    currentY += bodyFontSize * 0.4 * itemSpacing;
                }
                
                checkAddPage(subHeadingFontSize + bodyFontSize * 3); // Estimate space
                pdf.setFontSize(subHeadingFontSize);
                pdf.setFont(standardFont, 'bold');
                // Add Project Name (left aligned)
                pdf.text(proj.projectName || 'Project Name', margin, currentY);
                
                // Add Date (right aligned, if present)
                if(proj.date) {
                    pdf.setFont(standardFont, 'normal');
                    pdf.text(proj.date, pageWidth - margin, currentY, { align: 'right' });
                }
                currentY += subHeadingFontSize * 1.05 * spacingFactor; // Move Y down with spacing factor

                // Add Link (if present)
                if (proj.link) {
                    checkAddPage(bodyFontSize * 1.2);
                    pdf.setFontSize(bodyFontSize - 1); // Smaller font for link
                    pdf.setFont(standardFont, 'italic');
                    currentY = addWrappedText(proj.link, margin, currentY, contentWidth);
                }

                // Add Description (as bullet points)
                if (proj.description) {
                    const descLines = proj.description.split('\n').map(line => line.trim()).filter(line => line);
                    descLines.forEach((line, i) => {
                        const cleanLine = line.replace(/^[\*\-\•]\s*/, '');
                        
                        // Check for page break, but only if not the first line
                        if (i > 0) {
                            checkAddPage(bodyFontSize * 1.2);
                        }
                        
                        pdf.setFontSize(bodyFontSize);
                        pdf.setFont(standardFont, 'normal');
                        pdf.text('•', margin + 3, currentY); // Draw bullet closer
                        currentY = addWrappedText(cleanLine, margin + 12, currentY, contentWidth - 12); // Indented text
                    });
                }
                
                // Add spacing after each project
                if (index < resumeData.projects.length - 1) {
                    currentY += bodyFontSize * 0.4 * itemSpacing;
                }
            });
            
            // Add spacing after the section
            currentY += bodyFontSize * 0.5 * sectionSpacing;
        }
    }

    // --- 6. Skills Section ---
    if (resumeData.skills) {
        if (addSectionHeading('Skills')) {
            checkAddPage(bodyFontSize * 3); // Estimate space
            // Format skills as a comma-separated list
            const skillsList = resumeData.skills.split(/[\n,]+/).map(s => s.trim()).filter(s => s);
            currentY = addWrappedText(skillsList.join(', '), margin, currentY, contentWidth);
            currentY += bodyFontSize * 0.7 * sectionSpacing; // Add space after skills with section spacing
        }
    }

    // --- 7. Certifications Section ---
    if (resumeData.certifications && resumeData.certifications.length > 0) {
        if (addSectionHeading('Certifications')) {
            resumeData.certifications.forEach((cert, index) => {
                // Add item spacing between certifications
                if (index > 0) {
                    currentY += bodyFontSize * 0.3 * itemSpacing;
                }
                
                checkAddPage(bodyFontSize * 2); // Estimate space
                pdf.setFontSize(bodyFontSize);
                
                // Handle available width for certification text
                let availableWidth = contentWidth;
                const dateText = cert.date || '';
                if (dateText) {
                    pdf.setFont(standardFont, 'normal');
                    let dateWidth = pdf.getTextWidth(dateText) + 5;
                    availableWidth = contentWidth - dateWidth;
                    pdf.text(dateText, pageWidth - margin, currentY, { align: 'right' });
                }
                
                // Combine certification name and issuing body
                let certLine = cert.certificationName || 'Certification';
                if (cert.issuingBody) {
                    certLine += ` - ${cert.issuingBody}`;
                }
                
                // Add certification with bold style
                pdf.setFont(standardFont, 'bold');
                currentY = addWrappedText(certLine, margin, currentY, availableWidth);
                
                // Add space between certifications
                if (index < resumeData.certifications.length - 1) {
                    currentY += bodyFontSize * 0.3 * itemSpacing;
                }
            });
        }
    }

    // --- Optimize white space by checking if we can fit more on the page ---
    // Get remaining space and distribute if there's still a gap
    const remainingSpace = pageHeight - margin - currentY;
    if (remainingSpace > 50) {
        console.log(`PDF has ${remainingSpace}px of empty space at bottom - applying distribution factor: ${distributionFactor}`);
        
        // If we still have significant white space at the end,
        // we could add a subtle footer or watermark
        if (remainingSpace > 100) {
            pdf.setFontSize(8);
            pdf.setTextColor(180, 180, 180); // Light gray
            pdf.text(`Generated on ${new Date().toLocaleDateString()}`, pageWidth/2, pageHeight - 20, {align: 'center'});
            pdf.setTextColor(0, 0, 0); // Reset color
        }
    }

    // --- Save PDF ---
    const filename = `Resume_${(resumeData.personal.name || 'User').replace(/ /g, '_')}.pdf`;
    pdf.save(filename);
    showToast(`📄 Resume downloaded as ${filename}`, 'success');
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// --- Live Preview Update Function ---
// --- Live Preview Update Function (Enhanced) ---
function updateResumePreview() {
    console.log("Updating resume preview content...");
    const resumeData = getResumeData(); // Calls the function you already have
    const previewArea = document.getElementById('resumePreviewArea');
    if (!previewArea) return;

    // Apply spacing variables to the preview area
    const spacingFactor = resumeData.settings.spacingFactor || 1.0;
    const sectionSpacing = resumeData.settings.sectionSpacing || 1.0;
    const itemSpacing = resumeData.settings.itemSpacing || 1.0;
    
    // Set CSS variables for spacing
    previewArea.style.setProperty('--spacing-factor', spacingFactor);
    previewArea.style.setProperty('--section-spacing', sectionSpacing);
    previewArea.style.setProperty('--item-spacing', itemSpacing);

    // Clear previous preview content
    previewArea.innerHTML = '';

    // Update preview area data attributes for proper sizing
    previewArea.setAttribute('data-doc-size', resumeData.settings.docSize || 'letter');

    // Check if there's any data to render
    if (Object.values(resumeData.personal).every(val => !val) && 
        !resumeData.objective && 
        !resumeData.experience.length && 
        !resumeData.education.length && 
        !resumeData.projects.length && 
        !resumeData.skills && 
        !resumeData.certifications.length) {
        previewArea.innerHTML = '<p class="text-center text-muted initial-preview-message">Resume preview will appear here as you enter details.</p>';
        return; // Show placeholder if no data
    }

    // --- Helper function to safely create HTML ---
    const createHtml = (tag, className = '', content = '', attributes = {}) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        // Use textContent for safety unless HTML is intended (like lists)
        if (typeof content === 'string' && !content.startsWith('<')) {
             el.textContent = content;
        } else if (typeof content === 'string') {
             el.innerHTML = content; // Use innerHTML carefully for list structures etc.
        } else if (Array.isArray(content)) {
             content.forEach(child => el.appendChild(child));
        } else if (content instanceof Node) {
             el.appendChild(content);
        }
        for (const attr in attributes) {
            el.setAttribute(attr, attributes[attr]);
        }
        return el;
    };

    // --- Build Preview HTML ---
    const fragment = document.createDocumentFragment();

    // Header
    if (resumeData.personal && Object.values(resumeData.personal).some(val => val)) {
        const headerDiv = createHtml('div', 'preview-header');
        if (resumeData.personal.name) {
            headerDiv.appendChild(createHtml('div', 'name', resumeData.personal.name));
        }
        let contactInfo = [
            resumeData.personal.location,
            resumeData.personal.phone,
            resumeData.personal.email,
            resumeData.personal.website
        ].filter(Boolean).join(' | ');
        if (contactInfo) {
            headerDiv.appendChild(createHtml('div', 'contact-info', contactInfo));
        }
        fragment.appendChild(headerDiv);
    }

    // Objective
    if (resumeData.objective) {
        const objectiveDiv = createHtml('div', 'preview-objective preview-section');
        objectiveDiv.appendChild(createHtml('p', '', resumeData.objective));
        fragment.appendChild(objectiveDiv);
    }

    // Function to render section items (enhanced)
    const renderSectionItems = (title, sectionKey, items) => {
        // Check if section should be hidden
        const editorSection = document.querySelector(`.resume-section[data-section="${sectionKey}"]`);
        const isHidden = editorSection?.classList.contains('hidden');

        if (!items || items.length === 0) return null;

        const sectionDiv = createHtml('div', `preview-section preview-${sectionKey} ${isHidden ? 'hidden' : ''}`);
        sectionDiv.appendChild(createHtml('h2', '', title));

        items.forEach((item, index) => {
            const itemDiv = createHtml('div', 'preview-item');
            // Add spacing classes based on position
            if (index > 0) {
                itemDiv.classList.add('mt-item'); // Add class for margin top when not first item
            }
            
            const itemHeader = createHtml('div', 'item-header');
            let titleText = '';
            let dateText = '';
            let subtitleText = '';

            // Customize based on section
            if (sectionKey === 'experience') {
                titleText = item.jobTitle || 'Job Title';
                dateText = item.date || '';
                subtitleText = `${item.company || 'Company'} | ${item.location || 'Location'}`;
            } else if (sectionKey === 'education') {
                titleText = item.degreeMajor || 'Degree/Major';
                dateText = item.date || '';
                subtitleText = `${item.school || 'School'} | ${item.location || 'Location'} ${item.gpa ? `| GPA: ${item.gpa}` : ''}`;
            } else if (sectionKey === 'projects') {
                titleText = item.projectName || 'Project Name';
                dateText = item.date || '';
                subtitleText = item.link ? `<a href="${item.link}" target="_blank">${item.link}</a>` : '';
            } else if (sectionKey === 'certifications') {
                // For certifications, we'll format like PDF - combined bold name and issuing body
                titleText = item.certificationName || 'Certification';
                if (item.issuingBody) {
                    titleText += ` - ${item.issuingBody}`;
                }
                dateText = item.date || '';
            }

            // Use .textContent or innerHTML appropriately
            if (sectionKey === 'certifications') {
                // For certifications, we might include HTML formatting
                const titleSpan = createHtml('span', 'item-title');
                titleSpan.innerHTML = `<strong>${item.certificationName || 'Certification'}</strong>`;
                if (item.issuingBody) {
                    titleSpan.innerHTML += ` - ${item.issuingBody}`;
                }
                itemHeader.appendChild(titleSpan);
            } else {
                itemHeader.appendChild(createHtml('span', 'item-title', titleText));
            }
            
            if (dateText) {
                itemHeader.appendChild(createHtml('span', 'item-date', dateText));
            }
            itemDiv.appendChild(itemHeader);

            if (subtitleText && sectionKey !== 'certifications') {
                itemDiv.appendChild(createHtml('div', 'item-subtitle', subtitleText));
            }

            // Handle descriptions
            if (item.description) {
                const descLines = item.description.split('\n').map(line => line.trim()).filter(line => line);
                if (descLines.length > 0) {
                    const ul = createHtml('ul');
                    descLines.forEach(line => {
                        const cleanLine = line.replace(/^[\*\-\•]\s*/, '');
                        ul.appendChild(createHtml('li', '', cleanLine));
                    });
                    itemDiv.appendChild(ul);
                }
            }
            
            // Handle education additional info
            if (sectionKey === 'education' && item.additionalInfo) {
                itemDiv.appendChild(createHtml('p', 'small text-muted', `Relevant Info: ${item.additionalInfo}`));
            }

            sectionDiv.appendChild(itemDiv);
        });
        return sectionDiv;
    };

    // Render sections
    const expSection = renderSectionItems('Work Experience', 'experience', resumeData.experience);
    if (expSection) fragment.appendChild(expSection);

    const eduSection = renderSectionItems('Education', 'education', resumeData.education);
    if (eduSection) fragment.appendChild(eduSection);

    const projSection = renderSectionItems('Projects', 'projects', resumeData.projects);
    if (projSection) fragment.appendChild(projSection);

    // Skills
    const skillsSectionEditor = document.querySelector('.resume-section[data-section="skills"]');
    const skillsHidden = skillsSectionEditor?.classList.contains('hidden');
    if (resumeData.skills && !skillsHidden) {
        const skillsSection = createHtml('div', 'preview-section preview-skills');
        skillsSection.appendChild(createHtml('h2', '', 'Skills'));
        const skillsList = resumeData.skills.split(/[\n,]+/).map(s => s.trim()).filter(s => s);
        skillsSection.appendChild(createHtml('p', '', skillsList.join(', ')));
        fragment.appendChild(skillsSection);
    }

    // Certifications
    const certSection = renderSectionItems('Certifications', 'certifications', resumeData.certifications);
    if (certSection) fragment.appendChild(certSection);

    // Append the built fragment to the preview area
    previewArea.appendChild(fragment);
    console.log("Preview content updated.");
}

// Function to apply document size settings to preview
function applyDocumentSize() {
    const docSizeOption = document.querySelector('input[name="resumeDocSize"]:checked')?.value || 'letter';
    const previewArea = document.getElementById('resumePreviewArea');
    
    if (previewArea) {
        // Clear previous size classes
        previewArea.classList.remove('size-letter', 'size-a4');
        previewArea.classList.add(`size-${docSizeOption}`);
        
        // Update data attribute for CSS targeting
        previewArea.setAttribute('data-doc-size', docSizeOption);
        
        // Apply actual dimensions that approximate paper sizes
        if (docSizeOption === 'letter') {
            // Letter dimensions (maintaining aspect ratio with max-width constraint)
            previewArea.style.maxWidth = '100%'; // Use container constraints
            previewArea.style.aspectRatio = '8.5/11'; // Standard US Letter ratio
        } else if (docSizeOption === 'a4') {
            // A4 dimensions (maintaining aspect ratio with max-width constraint)
            previewArea.style.maxWidth = '100%'; // Use container constraints
            previewArea.style.aspectRatio = '1/√2'; // Standard A4 ratio (approximately 1:1.414)
        }
        
        console.log(`Applied document size: ${docSizeOption} to preview area`);
    }
}

// Tracks usage of PDF downloads
function trackPdfDownload() {
    // Check if user is logged in
    if (!firebase.auth().currentUser) {
        showMessage('Please sign in to download PDFs', 'warning');
        if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignInModal === 'function') {
            irisAuth.showSignInModal();
        }
        return false;
    }
    
    // Check usage limit
    if (!checkFeatureAccess('pdfDownloads')) {
        return false;
    }
    
    // Increment usage counter
    if (typeof irisAuth !== 'undefined' && typeof irisAuth.incrementUsageCounter === 'function') {
        irisAuth.incrementUsageCounter('pdfDownloads')
            .then(result => {
                console.log('PDF download usage updated:', result);
                updateResumeBuilderUsageUI();
            })
            .catch(error => {
                console.error('Failed to update PDF download usage:', error);
            });
    }
    
    return true;
}

// Tracks usage of AI enhance feature
function trackAiEnhance() {
    // Check if user is logged in
    if (!firebase.auth().currentUser) {
        showMessage('Please sign in to use AI enhancement', 'warning');
        if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignInModal === 'function') {
            irisAuth.showSignInModal();
        }
        return false;
    }
    
    // Check usage limit
    if (!checkFeatureAccess('aiEnhance')) {
        return false;
    }
    
    // Increment usage counter
    if (typeof irisAuth !== 'undefined' && typeof irisAuth.incrementUsageCounter === 'function') {
        irisAuth.incrementUsageCounter('aiEnhance')
            .then(result => {
                console.log('AI enhance usage updated:', result);
                updateResumeBuilderUsageUI();
            })
            .catch(error => {
                console.error('Failed to update AI enhance usage:', error);
            });
    }
    
    return true;
}

// Check if user can use a specific feature
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
            showMessage(`You've reached your ${featureType === 'pdfDownloads' ? 'PDF download' : 'AI enhancement'} limit (${usageInfo.used}/${usageInfo.limit}). Please upgrade your plan to continue.`, 'warning');
            showUpgradeModal(featureType);
            return false;
        }
    }
    
    return true;
}

// Update UI to show usage limits
function updateResumeBuilderUsageUI() {
    const userProfile = irisAuth?.getUserProfile();
    if (!userProfile || !userProfile.usage) return;
    
    // Update PDF downloads counter
    const pdfUsage = userProfile.usage.pdfDownloads || { used: 0, limit: 0 };
    const aiUsage = userProfile.usage.aiEnhance || { used: 0, limit: 0 };
    
    // Update text on download button to show usage
    const downloadBtn = document.getElementById('downloadResumeBtn');
    if (downloadBtn) {
        const remainingPdf = Math.max(0, pdfUsage.limit - pdfUsage.used);
        downloadBtn.innerHTML = `<i class="fas fa-download me-1"></i> Download Resume (${remainingPdf} left)`;
        
        // Disable button if no downloads left
        downloadBtn.disabled = remainingPdf <= 0;
        if (remainingPdf <= 0) {
            downloadBtn.classList.remove('btn-primary');
            downloadBtn.classList.add('btn-secondary');
        } else {
            downloadBtn.classList.add('btn-primary');
            downloadBtn.classList.remove('btn-secondary');
        }
    }
    
    // Update all AI enhance buttons to show remaining usage
    const aiEnhanceButtons = document.querySelectorAll('.ai-generate-btn');
    const remainingAi = Math.max(0, aiUsage.limit - aiUsage.used);
    
    aiEnhanceButtons.forEach(button => {
        // We don't want to change the button too much, just add a counter
        if (remainingAi <= 0) {
            button.disabled = true;
            button.title = "AI enhance limit reached. Please upgrade.";
            // Keep original text but add the counter
            const originalText = button.innerHTML;
            if (!originalText.includes('(0)')) {
                button.innerHTML = originalText.replace('<i class="fas fa-magic"></i> Enhance', '<i class="fas fa-magic"></i> Enhance (0)');
            }
        } else {
            button.disabled = false;
            button.title = `Enhance content with AI (${remainingAi} left)`;
            // Update counter or add it if not present
            const originalText = button.innerHTML;
            if (originalText.includes('(')) {
                button.innerHTML = originalText.replace(/\(\d+\)/, `(${remainingAi})`);
            } else {
                button.innerHTML = originalText.replace('<i class="fas fa-magic"></i> Enhance', `<i class="fas fa-magic"></i> Enhance (${remainingAi})`);
            }
        }
    });
}

// Function to show upgrade modal for resume builder features
function showResumeBuilderUpgradeModal(featureType) {
    // Get current plan to determine what plans to highlight
    const currentPlan = irisAuth?.getUserProfile()?.plan || 'free';
    const modalContent = document.createElement('div');
    
    // Configure title and description based on feature
    let featureTitle = "Resume Builder";
    let featureDesc = "features";
    
    if (featureType === 'pdfDownloads') {
        featureTitle = "PDF Downloads";
        featureDesc = "resume PDF downloads";
    } else if (featureType === 'aiEnhance') {
        featureTitle = "AI Enhancement";
        featureDesc = "AI content enhancements";
    }
    
    // Determine recommended plan based on feature and current plan
    let recommendedPlan = 'standard'; // Default recommendation
    
    if (currentPlan === 'free') {
        recommendedPlan = 'starter'; // From free to starter as first step
    } else if (currentPlan === 'starter') {
        recommendedPlan = 'standard'; // From starter to standard for more features
    } else if (currentPlan === 'standard') {
        recommendedPlan = 'pro'; // From standard to pro for unlimited
    }
    
    modalContent.innerHTML = `
        <div class="modal fade" id="resumeUpgradeModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Upgrade for More ${featureTitle}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info">
                            <i class="fas fa-info-circle me-2"></i>
                            <strong>You've reached your ${featureDesc} limit on your current plan (${currentPlan}).</strong>
                            <p class="mb-0">Upgrade to continue using all resume builder features.</p>
                        </div>
                        
                        <div class="row mt-4">
                            <!-- Feature comparison -->
                            <div class="col-12 mb-4">
                                <table class="table table-bordered">
                                    <thead class="table-light">
                                        <tr>
                                            <th>Feature</th>
                                            <th>Free</th>
                                            <th>Starter</th>
                                            <th>Standard</th>
                                            <th>Pro</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td>PDF Downloads</td>
                                            <td>5</td>
                                            <td>20</td>
                                            <td>50</td>
                                            <td>100</td>
                                        </tr>
                                        <tr>
                                            <td>AI Enhancements</td>
                                            <td>5</td>
                                            <td>20</td>
                                            <td>50</td>
                                            <td>100</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            
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
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>20 PDF Downloads</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>20 AI Enhancements</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>5 Resume Analyses</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>1 Mock Interview</strong></li>
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
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>50 PDF Downloads</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>50 AI Enhancements</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>10 Resume Analyses</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>3 Mock Interviews</strong></li>
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
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>100 PDF Downloads</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>100 AI Enhancements</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>20 Resume Analyses</strong></li>
                                            <li><i class="fas fa-check text-success me-2"></i> <strong>5 Mock Interviews</strong></li>
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
    const upgradeModal = new bootstrap.Modal(document.getElementById('resumeUpgradeModal'));
    upgradeModal.show();
    
    // Add event listeners to plan select buttons
    document.querySelectorAll('.plan-select-btn').forEach(button => {
        button.addEventListener('click', function() {
            const planName = this.getAttribute('data-plan');
            selectPlan(planName, upgradeModal);
        });
    });
    
    // Clean up when modal is hidden
    document.getElementById('resumeUpgradeModal').addEventListener('hidden.bs.modal', function() {
        document.body.removeChild(modalContent);
    });
}

function showUpgradeModal(featureType) {
    // Determine which modal to show
    if (featureType === 'pdfDownloads' || featureType === 'aiEnhance') {
        showResumeBuilderUpgradeModal(featureType);
    } else {
        // Use the existing modal for other features
        showExistingUpgradeModal(featureType);
    }
}

// Updated showAddonPurchaseModal function
function showAddonPurchaseModal(featureType = null) {
    // First clean up any existing modals
    safelyCloseModal('paymentProcessingModal');
    safelyCloseModal('paymentSuccessModal');
    safelyCloseModal('limitReachedModal');
    
    const modal = document.getElementById('addonPurchaseModal');
    if (!modal) return;
    
    // If a specific feature was requested, focus on that card
    if (featureType) {
        // Scroll to and highlight that specific add-on card
        const featureCard = modal.querySelector(`.addon-purchase-btn[data-feature="${featureType}"]`)?.closest('.card');
        if (featureCard) {
            // Clear any existing highlights
            modal.querySelectorAll('.card').forEach(card => {
                card.classList.remove('border-primary');
            });
            
            featureCard.classList.add('border-primary');
            setTimeout(() => {
                featureCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    }
    
    // Show the modal
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
}

// Initialize add-on modal interaction
function initAddonPurchaseModal() {
    console.log("Initializing add-on purchase modal and buttons");
    
    // Buy add-on buttons in profile page
    document.querySelectorAll('.buy-addon-btn').forEach(button => {
        console.log("Found buy-addon-btn:", button.getAttribute('data-feature'));
        // Remove existing listeners by cloning and replacing
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
        
        // Add new click event listener
        newButton.addEventListener('click', function() {
            const featureType = this.getAttribute('data-feature');
            console.log(`Buy add-on button clicked for: ${featureType}`);
            showAddonPurchaseModal(featureType);
        });
    });
    
    // Quantity increase/decrease buttons inside modal
    document.querySelectorAll('.addon-quantity-decrease').forEach(button => {
        button.addEventListener('click', function() {
            const featureType = this.getAttribute('data-feature');
            const input = document.querySelector(`.addon-quantity-input[data-feature="${featureType}"]`);
            
            if (input) {
                const currentValue = parseInt(input.value) || 1;
                if (currentValue > 1) {
                    input.value = currentValue - 1;
                    updateAddonPrice(featureType, currentValue - 1);
                }
            }
        });
    });
    
    document.querySelectorAll('.addon-quantity-increase').forEach(button => {
        button.addEventListener('click', function() {
            const featureType = this.getAttribute('data-feature');
            const input = document.querySelector(`.addon-quantity-input[data-feature="${featureType}"]`);
            
            if (input) {
                const currentValue = parseInt(input.value) || 1;
                const maxValue = parseInt(input.getAttribute('max')) || 10;
                if (currentValue < maxValue) {
                    input.value = currentValue + 1;
                    updateAddonPrice(featureType, currentValue + 1);
                }
            }
        });
    });
    
    // Manual input changes
    document.querySelectorAll('.addon-quantity-input').forEach(input => {
        input.addEventListener('change', function() {
            const featureType = this.getAttribute('data-feature');
            const value = parseInt(this.value) || 1;
            const maxValue = parseInt(this.getAttribute('max')) || 10;
            const minValue = parseInt(this.getAttribute('min')) || 1;
            
            // Enforce min/max values
            if (value < minValue) this.value = minValue;
            if (value > maxValue) this.value = maxValue;
            
            updateAddonPrice(featureType, parseInt(this.value));
        });
    });
    
    // Purchase buttons inside the modal
    document.querySelectorAll('.addon-purchase-btn').forEach(button => {
        button.addEventListener('click', function() {
            const featureType = this.getAttribute('data-feature');
            const quantityInput = document.querySelector(`.addon-quantity-input[data-feature="${featureType}"]`);
            const quantity = parseInt(quantityInput?.value) || 1;
            
            console.log(`Purchase add-on clicked: ${featureType}, quantity: ${quantity}`);
            purchaseAddonItem(featureType, quantity);
        });
    });
}

// Update price display based on quantity
function updateAddonPrice(featureType, quantity) {
    const priceElement = document.querySelector(`.addon-price[data-base-price][data-feature="${featureType}"]`) || 
                         document.querySelector(`.card:has(.addon-purchase-btn[data-feature="${featureType}"]) .addon-price[data-base-price]`);
    
    if (priceElement) {
        const basePrice = parseInt(priceElement.getAttribute('data-base-price')) || 0;
        const totalPrice = basePrice * quantity;
        priceElement.textContent = totalPrice;
    }
}

// Modify purchaseAddonItem function 
function purchaseAddonItem(featureType, quantity) {
    // First, check if user is logged in and verified
    if (!firebase.auth().currentUser) {
        showMessage('Please sign in to purchase add-ons', 'warning');
        if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignInModal === 'function') {
            irisAuth.showSignInModal();
        }
        return;
    }
    
    // Check if email is verified
    if (!authState.isEmailVerified) {
        // Store for later and prompt verification
        localStorage.setItem('postVerificationAddon', JSON.stringify({
            featureType: featureType,
            quantity: quantity
        }));
        showMessage('You need to verify your email before purchasing add-ons', 'warning');
        showEmailVerificationModal(firebase.auth().currentUser.email);
        return;
    }
    
    // Get user
    const user = firebase.auth().currentUser;
    
    // Calculate addon price
    const addonPrices = {
        'resumeAnalyses': 19,  // ₹19 per analysis
        'mockInterviews': 89,  // ₹89 per interview
        'pdfDownloads': 9,     // ₹9 per 10 downloads
        'aiEnhance': 9         // ₹9 per 5 enhancements
    };
    
    // Calculate how many units the user actually gets
    const quantityMultipliers = {
        'pdfDownloads': 10,  // 10 downloads per unit
        'aiEnhance': 5       // 5 enhancements per unit
    };
    
    // Get price and effective quantity
    const basePrice = addonPrices[featureType] || 0;
    const totalPrice = basePrice * quantity;
    const effectiveQuantity = quantity * (quantityMultipliers[featureType] || 1);
    
    // Show processing modal
    // First safely close the addon purchase modal if open
    safelyCloseModal('addonPurchaseModal');
    
    // Create processing modal
    const processingModalContent = document.createElement('div');
    processingModalContent.className = 'modal fade dynamic-modal';
    processingModalContent.id = 'paymentProcessingModal';
    processingModalContent.setAttribute('tabindex', '-1');
    processingModalContent.setAttribute('aria-hidden', 'true');
    processingModalContent.setAttribute('data-bs-backdrop', 'static');
    
    processingModalContent.innerHTML = `
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Processing Payment</h5>
                </div>
                <div class="modal-body text-center">
                    <div class="spinner-border text-primary mb-3" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p id="paymentProcessingMessage">Processing your purchase of ${quantity} ${getFeatureDisplayName(featureType)} add-on(s)...</p>
                    <div class="progress mt-3">
                        <div id="payment-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 30%"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Append and show processing modal
    document.body.appendChild(processingModalContent);
    const processingModal = new bootstrap.Modal(processingModalContent, {
        backdrop: 'static',
        keyboard: false
    });
    processingModal.show();
    
    // Prepare order data for backend
    const orderData = {
        featureType: featureType,
        quantity: quantity,
        effectiveQuantity: effectiveQuantity,
        amount: totalPrice * 100, // Amount in paise
        currency: "INR",
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || user.email.split('@')[0],
        orderType: 'addon'
    };
    
    // Call backend to create order
    fetch(`${API_BASE_URL}/create-razorpay-order`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(orderData)
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                throw new Error(errData.error || `Order creation failed (${response.status})`);
            });
        }
        return response.json();
    })
    .then(orderResponse => {
        // Update progress bar
        const progressBar = document.getElementById('payment-progress-bar');
        if (progressBar) progressBar.style.width = '60%';
        
        // Initialize Razorpay options
        const options = {
            key: orderResponse.key_id,
            amount: orderResponse.amount,
            currency: orderResponse.currency,
            name: "IRIS",
            description: `${quantity} ${getFeatureDisplayName(featureType)} Add-on${quantity > 1 ? 's' : ''}`,
            order_id: orderResponse.razorpay_order_id,
            prefill: {
                name: orderData.userName,
                email: orderData.userEmail,
                contact: ""
            },
            theme: {
                color: "#4A6FDC"
            },
            modal: {
                ondismiss: function() {
                    safelyCloseModal('paymentProcessingModal');
                    showMessage("Add-on purchase cancelled.", "warning");
                }
            },
            handler: function(response) {
                // This function runs after successful payment
                if (progressBar) progressBar.style.width = '90%';
                
                // Verify payment with backend
                verifyAddonPayment(response, orderResponse.razorpay_order_id, featureType, quantity, effectiveQuantity);
            }
        };
        
        // Initialize Razorpay
        const rzp = new Razorpay(options);
        rzp.open();
        
        // Add event handler for payment failure
        rzp.on('payment.failed', function(response) {
            safelyCloseModal('paymentProcessingModal');
            showMessage(`Payment failed: ${response.error.description}`, "danger");
            
            // Record failure for analytics
            fetch(`${API_BASE_URL}/record-payment-failure`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: user.uid,
                    orderId: orderResponse.razorpay_order_id,
                    reason: response.error.description
                })
            }).catch(err => console.error("Error recording payment failure:", err));
        });
    })
    .catch(error => {
        console.error("Addon order creation error:", error);
        safelyCloseModal('paymentProcessingModal');
        showMessage(`Error initiating payment: ${error.message}`, "danger");
    });
}

function verifyAddonPayment(paymentResponse, orderId, featureType, quantity, effectiveQuantity) {
    const verificationData = {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentResponse.razorpay_payment_id,
        razorpay_signature: paymentResponse.razorpay_signature,
        userId: firebase.auth().currentUser.uid,
        featureType: featureType,
        quantity: quantity,
        effectiveQuantity: effectiveQuantity,
        orderType: 'addon'
    };
    
    fetch(`${API_BASE_URL}/verify-razorpay-payment`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(verificationData)
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                throw new Error(errData.error || `Payment verification failed (${response.status})`);
            });
        }
        return response.json();
    })
    .then(data => {
        // Update progress bar
        const progressBar = document.getElementById('payment-progress-bar');
        if (progressBar) progressBar.style.width = '100%';
        
        // Close processing modal
        safelyCloseModal('paymentProcessingModal');
        
        if (data.success) {
            // Show success message
            showMessage(`Successfully purchased ${quantity} ${getFeatureDisplayName(featureType)} add-on${quantity > 1 ? 's' : ''}!`, 'success');
            
            // Update local state
            if (authState && authState.userProfile && authState.userProfile.usage && authState.userProfile.usage[featureType]) {
                authState.userProfile.usage[featureType].limit = data.newLimit;
            }
            
            // Update UI
            updateUsageDisplay();
            updateResumeBuilderUsageUI();
            
            // Show success modal
            const successModal = new bootstrap.Modal(document.getElementById('paymentSuccessModal'));
            document.getElementById('paymentSuccessMessage').textContent = 
                `You've successfully purchased ${quantity} ${getFeatureDisplayName(featureType)} add-on${quantity > 1 ? 's' : ''}. Your limit has been increased.`;
            
            // Set new limits in success modal
            setSuccessModalLimits(featureType, data.newLimit);
            
            successModal.show();
        } else {
            showMessage(`Add-on purchase verification failed: ${data.error || 'Unknown error'}`, 'danger');
        }
    })
    .catch(error => {
        console.error("Addon payment verification error:", error);
        safelyCloseModal('paymentProcessingModal');
        showMessage(`Error verifying payment: ${error.message}`, "danger");
    });
}

// Helper function to update usage display for a specific feature
function updateFeatureUsageDisplay(featureType, usageData = { used: 0, limit: 0 }) {
    const countElement = document.getElementById(`${featureType}Count`);
    const progressBar = document.querySelector(`#${featureType}Count + .progress .progress-bar`);
    
    if (countElement) {
        countElement.textContent = `${usageData.used}/${usageData.limit}`;
    }
    
    if (progressBar) {
        const percentUsed = usageData.limit > 0 ? (usageData.used / usageData.limit) * 100 : 0;
        progressBar.style.width = `${Math.min(100, percentUsed)}%`;
        
        // Add warning color if close to limit
        if (percentUsed >= 85) {
            progressBar.classList.add('bg-warning');
            if (percentUsed >= 100) {
                progressBar.classList.add('bg-danger');
                progressBar.classList.remove('bg-warning');
            }
        } else {
            progressBar.classList.remove('bg-warning', 'bg-danger');
        }
    }
}

function showLimitReachedModal(featureType) {
    // Get the modal element
    const modal = document.getElementById('limitReachedModal');
    if (!modal) return;
    
    // Set the message based on feature type
    const messageElement = document.getElementById('limitReachedMessage');
    if (messageElement) {
        const featureDisplayName = getFeatureDisplayName(featureType);
        messageElement.innerHTML = `
            You've reached your ${featureDisplayName} limit on your current plan. 
            You can <strong>upgrade your plan</strong> for more features or 
            <strong>purchase individual add-ons</strong> for this specific feature.
        `;
    }
    
    // Modify the buttons in the modal
    const upgradeBtn = document.getElementById('limitReachedUpgradeBtn');
    const closeBtn = modal.querySelector('button[data-bs-dismiss="modal"]');
    
    // Create or update the Buy Add-ons button
    let addonBtn = document.getElementById('limitReachedAddonBtn');
    if (!addonBtn) {
        addonBtn = document.createElement('button');
        addonBtn.id = 'limitReachedAddonBtn';
        addonBtn.className = 'btn btn-success';
        addonBtn.innerHTML = `<i class="fas fa-plus-circle me-2"></i> Buy Add-ons`;
        
        // Insert before the upgrade button
        if (upgradeBtn) {
            upgradeBtn.parentNode.insertBefore(addonBtn, upgradeBtn);
        }
    }
    
    // Clear existing event listeners
    const newAddonBtn = addonBtn.cloneNode(true);
    if (addonBtn.parentNode) {
        addonBtn.parentNode.replaceChild(newAddonBtn, addonBtn);
    }
    
    // Add event listener for add-on button
    newAddonBtn.addEventListener('click', function() {
        // Hide the limit reached modal
        const limitModal = bootstrap.Modal.getInstance(modal);
        if (limitModal) limitModal.hide();
        
        // Show the add-on purchase modal
        setTimeout(() => showAddonPurchaseModal(featureType), 400);
    });
    
    // Update the upgrade button to close the modal and show the upgrade modal
    if (upgradeBtn) {
        const newUpgradeBtn = upgradeBtn.cloneNode(true);
        upgradeBtn.parentNode.replaceChild(newUpgradeBtn, upgradeBtn);
        
        newUpgradeBtn.addEventListener('click', function() {
            // Hide the limit reached modal
            const limitModal = bootstrap.Modal.getInstance(modal);
            if (limitModal) limitModal.hide();
            
            // Show the plan upgrade modal
            setTimeout(() => showUpgradeModal(featureType), 400);
        });
    }
    
    // Show the modal
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
}

function safelyCloseModal(modalId) {
    console.log(`[MODAL_DEBUG] Attempting to safely close modal: ${modalId}`);
    
    try {
        // Get the modal element
        const modalElement = document.getElementById(modalId);
        console.log(`[MODAL_DEBUG] Modal element exists: ${!!modalElement}`);
        
        if (!modalElement) {
            console.log(`[MODAL_DEBUG] Modal ${modalId} not found in DOM. Nothing to close.`);
            return;
        }
        
        // Check if modal has bootstrap data
        const hasBootstrapData = modalElement.classList.contains('modal') && 
                              typeof bootstrap !== 'undefined' && 
                              typeof bootstrap.Modal !== 'undefined';
        
        console.log(`[MODAL_DEBUG] Modal has Bootstrap data: ${hasBootstrapData}`);
        
        // Get the Bootstrap modal instance
        let modalInstance = null;
        
        if (hasBootstrapData) {
            try {
                modalInstance = bootstrap.Modal.getInstance(modalElement);
                console.log(`[MODAL_DEBUG] Bootstrap modal instance exists: ${!!modalInstance}`);
            } catch (instanceError) {
                console.error(`[MODAL_DEBUG] Error getting modal instance:`, instanceError);
            }
        }
        
        if (modalInstance) {
            // Close the modal properly
            console.log(`[MODAL_DEBUG] Calling bootstrap hide() method on modal`);
            modalInstance.hide();
        } else {
            console.log(`[MODAL_DEBUG] No Bootstrap instance found, will rely on DOM cleanup only`);
        }
        
        // Check for modal-open class on body
        const bodyHasModalOpenClass = document.body.classList.contains('modal-open');
        console.log(`[MODAL_DEBUG] Body has modal-open class: ${bodyHasModalOpenClass}`);
        
        // Check for backdrop elements
        const backdropElements = document.querySelectorAll('.modal-backdrop');
        console.log(`[MODAL_DEBUG] Found ${backdropElements.length} backdrop elements`);
        
        // Remove any lingering backdrops immediately
        console.log(`[MODAL_DEBUG] Setting timeout to clean up DOM`);
        setTimeout(() => {
            console.log(`[MODAL_DEBUG] Executing DOM cleanup for modal ${modalId}`);
            
            // Re-check backdrop elements
            const remainingBackdrops = document.querySelectorAll('.modal-backdrop');
            console.log(`[MODAL_DEBUG] Found ${remainingBackdrops.length} backdrop elements during cleanup`);
            
            remainingBackdrops.forEach((backdrop, index) => {
                console.log(`[MODAL_DEBUG] Removing backdrop #${index}`);
                backdrop.classList.remove('show');
                backdrop.remove(); // Force immediate removal
            });
            
            // Force cleanup of modal-related body classes
            if (document.body.classList.contains('modal-open')) {
                console.log(`[MODAL_DEBUG] Removing modal-open class from body`);
                document.body.classList.remove('modal-open');
            }
            
            // Clean up padding-right style (added by Bootstrap)
            if (document.body.style.paddingRight) {
                console.log(`[MODAL_DEBUG] Removing padding-right style from body`);
                document.body.style.removeProperty('padding-right');
            }
            
            // Clean up overflow style (added by Bootstrap)
            if (document.body.style.overflow) {
                console.log(`[MODAL_DEBUG] Removing overflow style from body`);
                document.body.style.removeProperty('overflow');
            }
            
            // For dynamically created modals, remove from DOM
            if (modalElement.classList.contains('dynamic-modal')) {
                console.log(`[MODAL_DEBUG] Modal is dynamic, removing from DOM`);
                if (modalElement.parentNode) {
                    modalElement.parentNode.removeChild(modalElement);
                    console.log(`[MODAL_DEBUG] Dynamic modal removed from DOM`);
                } else {
                    console.log(`[MODAL_DEBUG] Dynamic modal has no parent, cannot remove`);
                }
            }
            
            console.log(`[MODAL_DEBUG] DOM cleanup complete for modal ${modalId}`);
        }, 100);
    } catch (error) {
        console.error(`[MODAL_DEBUG] Error safely closing modal ${modalId}:`, error);
        // Emergency cleanup
        console.log(`[MODAL_DEBUG] Performing emergency cleanup`);
        document.querySelectorAll('.modal-backdrop').forEach(el => {
            console.log(`[MODAL_DEBUG] Emergency removal of backdrop element`);
            el.remove();
        });
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('padding-right');
        document.body.style.removeProperty('overflow');
        console.log(`[MODAL_DEBUG] Emergency cleanup complete`);
    }
}

// Add enhanced close handlers to all modals
function enhanceModalCloseHandlers() {
    const modals = [
        'addonPurchaseModal',
        'paymentProcessingModal',
        'paymentSuccessModal',
        'limitReachedModal',
        'jobDetailsModal', // Add job details modal to the list
        'auth-modal' // Add auth modal to the list
    ];
    
    modals.forEach(modalId => {
        const modalElement = document.getElementById(modalId);
        if (!modalElement) return;
        
        // Add hidden.bs.modal event listener
        modalElement.addEventListener('hidden.bs.modal', function(event) {
            console.log(`Modal ${modalId} closed properly`);
            
            // Extra aggressive cleanup - remove any lingering backdrops immediately
            document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                backdrop.remove();
            });
            
            // Reset body classes and styles
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('padding-right');
            document.body.style.removeProperty('overflow');
            
            // Remove the emergency button if it's visible
            const emergencyButton = document.getElementById('emergency-modal-cleanup');
            if (emergencyButton && emergencyButton.style.display === 'block') {
                emergencyButton.style.display = 'none';
            }
        });
        
        // Make sure close buttons work properly
        const closeButtons = modalElement.querySelectorAll('[data-bs-dismiss="modal"]');
        closeButtons.forEach(button => {
            // Clone and replace to remove old listeners
            const newButton = button.cloneNode(true);
            if (button.parentNode) {
                button.parentNode.replaceChild(newButton, button);
            }
            
            // Add enhanced close handler
            newButton.addEventListener('click', function(event) {
                // Close modal properly
                const modalInstance = bootstrap.Modal.getInstance(modalElement);
                if (modalInstance) {
                    modalInstance.hide();
                }
                
                // Force cleanup
                setTimeout(() => {
                    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                        backdrop.remove();
                    });
                    document.body.classList.remove('modal-open');
                    document.body.style.removeProperty('padding-right');
                    document.body.style.overflow = '';
                }, 300);
            });
        });
    });
    
    // Also handle ESC key globally for better modal cleanup
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            // Check if any modal is visible
            const visibleModals = document.querySelectorAll('.modal.show');
            if (visibleModals.length > 0) {
                // Force cleanup after a short delay
                setTimeout(() => {
                    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                        backdrop.remove();
                    });
                    document.body.classList.remove('modal-open');
                    document.body.style.removeProperty('padding-right');
                    document.body.style.overflow = '';
                }, 300);
            }
        }
    });
}

// Helper function to set limit values in success modal
function setSuccessModalLimits(planName) {
    // If we're setting a plan name, we should reset all counters
    const isFullPlanUpgrade = !!planName;
    
    const limitElements = {
        'resumeAnalyses': document.getElementById('newResumeLimit'),
        'mockInterviews': document.getElementById('newInterviewLimit'),
        'pdfDownloads': document.getElementById('newPdfLimit'),
        'aiEnhance': document.getElementById('newAiLimit')
    };
    
    // For plan upgrades, set all usage displays to their new limits
    if (isFullPlanUpgrade) {
        for (const [key, element] of Object.entries(limitElements)) {
            if (element) {
                const newLimit = getPackageLimit(key, planName);
                element.textContent = newLimit;
            }
        }
        
        // Update the displayed usage counters to 0 as well, if these elements exist
        const usedElements = {
            'resumeAnalyses': document.getElementById('resumeAnalysesCount'),
            'mockInterviews': document.getElementById('mockInterviewsCount'),
            'pdfDownloads': document.getElementById('pdfDownloadsCount'),
            'aiEnhance': document.getElementById('aiEnhanceCount')
        };
        
        for (const [key, element] of Object.entries(usedElements)) {
            if (element) {
                const newLimit = getPackageLimit(key, planName);
                element.textContent = `0/${newLimit}`;
            }
        }
    } 
    // For individual feature updates (add-ons), just update that specific feature
    else {
        if (limitElements[featureType]) {
            limitElements[featureType].textContent = newLimit;
        }
        
        // Set current values for other features
        for (const [key, element] of Object.entries(limitElements)) {
            if (key !== featureType && element) {
                const currentLimit = authState?.userProfile?.usage?.[key]?.limit || 0;
                element.textContent = currentLimit;
            }
        }
    }
}

function setupGlobalModalCleanup() {
    // Create emergency cleanup button (hidden by default)
    const emergencyButton = document.createElement('button');
    emergencyButton.id = 'emergency-modal-cleanup';
    emergencyButton.className = 'btn btn-danger btn-sm';
    emergencyButton.style.cssText = 'position: fixed; bottom: 10px; right: 10px; z-index: 10000; opacity: 0.6; display: none;';
    emergencyButton.innerHTML = '<i class="fas fa-times-circle"></i> Unstick UI';
    emergencyButton.onclick = function() {
        console.log("Emergency cleanup triggered by user");
        
        // Close all known modals
        ['upgradeModal', 'paymentProcessingModal', 'paymentSuccessModal', 
         'limitReachedModal', 'addonPurchaseModal', 'auth-modal', 'jobDetailsModal'].forEach(modalId => {
            const modalEl = document.getElementById(modalId);
            if (modalEl) {
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) {
                    modalInstance.hide();
                }
            }
        });
        
        // Force remove any modal backdrops
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        
        // Reset body
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('padding-right');
        document.body.style.removeProperty('overflow');
        
        // Hide the emergency button
        this.style.display = 'none';
    };
    document.body.appendChild(emergencyButton);
    
    // Check less frequently to reduce the chance of showing the button unnecessarily
    // Only show after a longer delay of potential stuck state
    let potentiallyStuckCounter = 0;
    
    setInterval(function() {
        const hasModalClass = document.body.classList.contains('modal-open');
        const hasVisibleModals = document.querySelectorAll('.modal.show').length > 0;
        const hasBackdrops = document.querySelectorAll('.modal-backdrop').length > 0;
        
        // If body has modal class but no visible modal, or has backdrops but no visible modal
        const isPossiblyStuck = (hasModalClass && !hasVisibleModals) || 
                              (hasBackdrops && !hasVisibleModals);
        
        if (isPossiblyStuck) {
            potentiallyStuckCounter++;
            // Only show the button if stuck for more than 3 checks (6 seconds)
            if (potentiallyStuckCounter >= 3) {
                document.getElementById('emergency-modal-cleanup').style.display = 'block';
            }
        } else {
            potentiallyStuckCounter = 0;
            document.getElementById('emergency-modal-cleanup').style.display = 'none';
        }
    }, 2000); // Check every 2 seconds
}

// Add this function to modify the showExistingUpgradeModal function to ensure proper cleanup
function enhanceUpgradeModal() {
    // Patch the existing showExistingUpgradeModal function to ensure modals close properly
    const originalShowUpgradeModal = window.showExistingUpgradeModal;
    
    if (typeof originalShowUpgradeModal === 'function') {
        window.showExistingUpgradeModal = function(featureType) {
            // First clean up any existing modals
            safelyCloseModal('upgradeModal');
            
            // Call the original function
            originalShowUpgradeModal(featureType);
            
            // Add additional event listener to the close button
            setTimeout(() => {
                const modal = document.getElementById('upgradeModal');
                if (modal) {
                    const closeButtons = modal.querySelectorAll('[data-bs-dismiss="modal"]');
                    closeButtons.forEach(button => {
                        button.addEventListener('click', function() {
                            safelyCloseModal('upgradeModal');
                        }, { once: true });
                    });
                    
                    // Add event listener for modal hidden event
                    modal.addEventListener('hidden.bs.modal', function() {
                        // Double-check for any lingering backdrops after a short delay
                        setTimeout(() => {
                            safelyCloseModal('upgradeModal');
                            
                            // Make sure body is scrollable
                            document.body.style.overflow = '';
                        }, 300);
                    }, { once: true });
                }
            }, 100);
        };
    }
    
    // Also patch showPaymentModal if it exists
    const originalShowPaymentModal = window.showPaymentModal;
    if (typeof originalShowPaymentModal === 'function') {
        window.showPaymentModal = function() {
            // First clean up any existing modals
            safelyCloseModal('upgradeModal');
            
            // Call the original function
            originalShowPaymentModal();
            
            // Similarly, enhance the new modal with proper close handling
            // (implementation similar to above)
        };
    }
}

function selectPlanFixed(planName) {
    console.log(`[PLAN_DEBUG] Selected plan: ${planName}`);
    
    // First, clean up any existing modals
    console.log("[PLAN_DEBUG] Cleaning up existing modals");
    safelyCloseModal('paymentProcessingModal');
    safelyCloseModal('paymentSuccessModal');
    
    // Get plan pricing based on planName
    const planPrices = {
        'starter': 199,
        'standard': 399,
        'pro': 799
    };
    
    const planPrice = planPrices[planName] || 0;
    console.log(`[PLAN_DEBUG] Plan price: ${planPrice} INR`);
    
    if (planPrice === 0) {
        console.error(`[PLAN_DEBUG] Invalid plan selected: ${planName}`);
        showMessage("Error processing payment: Invalid plan", "danger");
        return;
    }
    
    // Get user data
    const user = firebase.auth().currentUser;
    console.log(`[PLAN_DEBUG] Current user: ${user ? user.email : 'not logged in'}`);
    
    if (!user) {
        console.warn("[PLAN_DEBUG] User not logged in");
        showMessage("Please sign in to upgrade your plan", "warning");
        if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignInModal === 'function') {
            irisAuth.showSignInModal();
        }
        return;
    }
    
    // Create processing modal with better error handling
    const processingModalId = 'paymentProcessingModal';
    let processingModal = document.getElementById(processingModalId);
    console.log(`[PLAN_DEBUG] Processing modal exists: ${!!processingModal}`);
    
    // Remove existing modal if present (clean slate approach)
    if (processingModal) {
        console.log("[PLAN_DEBUG] Removing existing processing modal");
        processingModal.remove();
    }
    
    // Create new modal
    console.log("[PLAN_DEBUG] Creating new processing modal");
    const processingModalContent = document.createElement('div');
    processingModalContent.className = 'modal fade dynamic-modal';
    processingModalContent.id = processingModalId;
    processingModalContent.setAttribute('tabindex', '-1');
    processingModalContent.setAttribute('aria-hidden', 'true');
    processingModalContent.setAttribute('data-bs-backdrop', 'static');
    
    processingModalContent.innerHTML = `
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-cog fa-spin me-2"></i> Processing Payment</h5>
                </div>
                <div class="modal-body text-center">
                    <div class="spinner-border text-primary mb-3" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p id="paymentProcessingMessage">Initializing payment for the ${planName.charAt(0).toUpperCase() + planName.slice(1)} plan...</p>
                    <div class="progress mt-3">
                        <div id="payment-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 30%"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Append and show processing modal
    console.log("[PLAN_DEBUG] Appending processing modal to body");
    document.body.appendChild(processingModalContent);
    processingModal = document.getElementById(processingModalId);
    console.log(`[PLAN_DEBUG] Processing modal after creation: ${!!processingModal}`);
    
    try {
        console.log("[PLAN_DEBUG] Initializing Bootstrap modal");
        const processingModalInstance = new bootstrap.Modal(processingModal, {
            backdrop: 'static',
            keyboard: false
        });
        console.log("[PLAN_DEBUG] Showing processing modal");
        processingModalInstance.show();
        console.log("[PLAN_DEBUG] Processing modal shown successfully");
    } catch (modalError) {
        console.error("[PLAN_DEBUG] Error showing processing modal:", modalError);
        // Continue anyway, we'll handle errors in the payment flow
    }
    
    // Prepare order data for backend
    const orderData = {
        planName: planName,
        amount: planPrice * 100, // Amount in paise
        currency: "INR",
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || user.email.split('@')[0],
        orderType: 'plan'
    };
    console.log("[PLAN_DEBUG] Order data prepared:", orderData);
    
    // Add retry mechanism and better error handling
    let retryCount = 0;
    const maxRetries = 2;
    
    const createOrder = () => {
        // Update progress message
        const progressMessage = document.getElementById('paymentProcessingMessage');
        const progressBar = document.getElementById('payment-progress-bar');
        
        if (progressMessage) {
            if (retryCount > 0) {
                progressMessage.textContent = `Retrying payment initialization (attempt ${retryCount+1})...`;
            } else {
                progressMessage.textContent = `Initializing payment for the ${planName.charAt(0).toUpperCase() + planName.slice(1)} plan...`;
            }
        }
        
        // Log the API URL being used
        const apiUrl = `${API_BASE_URL}/create-razorpay-order`;
        console.log(`[PLAN_DEBUG] Calling API: ${apiUrl}`);
        console.log(`[PLAN_DEBUG] Request body: ${JSON.stringify(orderData)}`);
        
        // Call backend to create order
        fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        })
        .then(response => {
            console.log(`[PLAN_DEBUG] API response status: ${response.status}`);
            console.log(`[PLAN_DEBUG] API response headers: ${JSON.stringify([...response.headers])}`);
            
            if (!response.ok) {
                return response.text().then(text => {
                    try {
                        // Try to parse as JSON
                        const errorData = JSON.parse(text);
                        console.error(`[PLAN_DEBUG] API error response (JSON): ${JSON.stringify(errorData)}`);
                        throw new Error(errorData.error || `Order creation failed (${response.status})`);
                    } catch (parseError) {
                        // If parsing fails, use the raw text
                        console.error(`[PLAN_DEBUG] API error response (text): ${text}`);
                        throw new Error(`Order creation failed (${response.status}): ${text.substring(0, 100)}...`);
                    }
                });
            }
            
            return response.json();
        })
        .then(orderResponse => {
            console.log(`[PLAN_DEBUG] Order created successfully. Order ID: ${orderResponse.razorpay_order_id}`);
            
            // Update progress bar
            if (progressBar) {
                progressBar.style.width = '60%';
                console.log("[PLAN_DEBUG] Updated progress bar to 60%");
            }
            
            // Initialize Razorpay options with better error handling
            console.log("[PLAN_DEBUG] Preparing Razorpay options");
            const options = {
                key: orderResponse.key_id,
                amount: orderResponse.amount,
                currency: orderResponse.currency,
                name: "IRIS",
                description: `${planName.charAt(0).toUpperCase() + planName.slice(1)} Plan Subscription`,
                order_id: orderResponse.razorpay_order_id,
                prefill: {
                    name: orderData.userName,
                    email: orderData.userEmail,
                    contact: "" // You could add phone number here if available
                },
                theme: {
                    color: "#4A6FDC" // Match your app's primary color
                },
                modal: {
                    ondismiss: function() {
                        // Handle dismissal
                        console.log("[PLAN_DEBUG] Razorpay modal dismissed by user");
                        safelyCloseModal(processingModalId);
                        showMessage("Payment cancelled. Your plan was not upgraded.", "warning");
                    }
                },
                handler: function(response) {
                    // This function runs after successful payment
                    console.log("[PLAN_DEBUG] Razorpay payment successful:", response);
                    
                    // Update progress bar to 90%
                    if (progressBar) {
                        progressBar.style.width = '90%';
                        console.log("[PLAN_DEBUG] Updated progress bar to 90%");
                    }
                    
                    // Verify payment with backend
                    verifyPayment(response, orderResponse.razorpay_order_id, planName);
                }
            };
            
            // Initialize Razorpay with error handling
            try {
                console.log("[PLAN_DEBUG] Initializing Razorpay instance");
                const rzp = new Razorpay(options);
                
                // Add event handler for payment failure
                rzp.on('payment.failed', function(response) {
                    console.error("[PLAN_DEBUG] Razorpay payment failed:", response);
                    safelyCloseModal(processingModalId);
                    const errorDesc = response.error?.description || 'Unknown error';
                    showMessage(`Payment failed: ${errorDesc}`, "danger");
                    
                    // Record failure for analytics
                    console.log("[PLAN_DEBUG] Recording payment failure");
                    fetch(`${API_BASE_URL}/record-payment-failure`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            userId: user.uid,
                            orderId: orderResponse.razorpay_order_id,
                            reason: errorDesc
                        })
                    }).catch(err => console.error("[PLAN_DEBUG] Error recording payment failure:", err));
                });
                
                // Open Razorpay checkout
                console.log("[PLAN_DEBUG] Opening Razorpay checkout");
                rzp.open();
                console.log("[PLAN_DEBUG] Razorpay checkout opened");
            } catch (rzpError) {
                console.error("[PLAN_DEBUG] Error initializing Razorpay:", rzpError);
                safelyCloseModal(processingModalId);
                showMessage(`Error initializing payment gateway: ${rzpError.message}. Please try again later.`, "danger");
            }
        })
        .catch(error => {
            console.error("[PLAN_DEBUG] Order creation error:", error);
            
            // Retry logic
            if (retryCount < maxRetries) {
                retryCount++;
                console.log(`[PLAN_DEBUG] Retry attempt ${retryCount}/${maxRetries}`);
                const progressMessage = document.getElementById('paymentProcessingMessage');
                if (progressMessage) {
                    progressMessage.textContent = `Retrying payment initialization in 2 seconds... (${retryCount}/${maxRetries})`;
                }
                setTimeout(createOrder, 2000); // Retry after 2 seconds
            } else {
                // Max retries reached
                console.error("[PLAN_DEBUG] Max retries reached. Giving up.");
                safelyCloseModal(processingModalId);
                showMessage(`Error initiating payment: ${error.message}. Please try again later.`, "danger");
            }
        });
    };
    
    // Start the order creation process
    console.log("[PLAN_DEBUG] Starting order creation process");
    createOrder();
}

function verifyPayment(paymentResponse, orderId, planName) {
    const verificationData = {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentResponse.razorpay_payment_id,
        razorpay_signature: paymentResponse.razorpay_signature,
        userId: firebase.auth().currentUser.uid,
        planName: planName,
        orderType: 'plan'
    };
    
    // First, show a message that verification is in progress
    showMessage("Verifying payment...", "info");
    
    fetch(`${API_BASE_URL}/verify-razorpay-payment`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(verificationData)
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                throw new Error(errData.error || `Payment verification failed (${response.status})`);
            }).catch(e => {
                // Handle case where response is not JSON
                throw new Error(`Payment verification failed (${response.status}): ${response.statusText}`);
            });
        }
        return response.json();
    })
    .then(data => {
        // Update progress bar to 100% if it exists
        const progressBar = document.getElementById('payment-progress-bar');
        if (progressBar) progressBar.style.width = '100%';
        
        console.log("Payment verification successful:", data);
        
        // Close processing modal BEFORE showing success modal
        safelyCloseModal('paymentProcessingModal');
        
        // Give a short delay to ensure DOM is ready
        setTimeout(() => {
            // Update local user profile with the new plan
            if (authState && authState.userProfile) {
                authState.userProfile.plan = planName;
                
                // Update limits based on the new plan
                if (!authState.userProfile.usage) {
                    authState.userProfile.usage = {};
                }
                
                // Update each feature limit
                const features = ['resumeAnalyses', 'mockInterviews', 'pdfDownloads', 'aiEnhance'];
                features.forEach(feature => {
                    if (!authState.userProfile.usage[feature]) {
                        authState.userProfile.usage[feature] = { used: 0, limit: 0 };
                    }
                    const limit = getPackageLimit(feature, planName);
                    authState.userProfile.usage[feature].limit = limit;
                });
            }
            
            // Update UI if function exists
            if (typeof updateUsageDisplay === 'function') {
                updateUsageDisplay();
            }
            
            // Show success message
            showMessage(`Successfully upgraded to ${planName.charAt(0).toUpperCase() + planName.slice(1)} plan!`, 'success');
            
            // Show success modal with full error handling
            try {
                showPaymentSuccessModal(planName, data);
            } catch (modalError) {
                console.error("Error showing success modal:", modalError);
                // We've already shown a success message as fallback
            }
        }, 300);
    })
    .catch(error => {
        console.error("Payment verification error:", error);
        
        // Safely close any processing modals
        safelyCloseModal('paymentProcessingModal');
        
        // Show error message
        showMessage(`Error verifying payment: ${error.message}`, "danger");
    });
}

// Helper function to update local plan limits (continued)
function updateLocalPlanLimits(planName) {
    if (!authState || !authState.userProfile || !authState.userProfile.usage) return;
    
    const resumeLimit = getPackageLimit(planName, 'resumeAnalyses');
    const interviewLimit = getPackageLimit(planName, 'mockInterviews');
    const pdfLimit = getPackageLimit(planName, 'pdfDownloads');
    const aiLimit = getPackageLimit(planName, 'aiEnhance');
    
    // Reset usage counters to 0 and update limits
    if (authState.userProfile.usage.resumeAnalyses) {
        authState.userProfile.usage.resumeAnalyses = { used: 0, limit: resumeLimit };
    } else {
        authState.userProfile.usage.resumeAnalyses = { used: 0, limit: resumeLimit };
    }
    
    if (authState.userProfile.usage.mockInterviews) {
        authState.userProfile.usage.mockInterviews = { used: 0, limit: interviewLimit };
    } else {
        authState.userProfile.usage.mockInterviews = { used: 0, limit: interviewLimit };
    }
    
    if (authState.userProfile.usage.pdfDownloads) {
        authState.userProfile.usage.pdfDownloads = { used: 0, limit: pdfLimit };
    } else {
        authState.userProfile.usage.pdfDownloads = { used: 0, limit: pdfLimit };
    }
    
    if (authState.userProfile.usage.aiEnhance) {
        authState.userProfile.usage.aiEnhance = { used: 0, limit: aiLimit };
    } else {
        authState.userProfile.usage.aiEnhance = { used: 0, limit: aiLimit };
    }
}

// Show success modal with updated limits
function showPaymentSuccessModal(planName, data) {
    console.log(`[PAYMENT_DEBUG] Showing payment success modal for plan: ${planName}`, data);
    
    // Ensure any existing modal is properly closed first
    console.log("[PAYMENT_DEBUG] Attempting to safely close processing modal first");
    safelyCloseModal('paymentProcessingModal');
    
    // Get or create the modal element
    let modalElement = document.getElementById('paymentSuccessModal');
    console.log(`[PAYMENT_DEBUG] Success modal exists: ${!!modalElement}`);
    
    if (!modalElement) {
        console.log("[PAYMENT_DEBUG] Creating new success modal element");
        // Create the modal if it doesn't exist
        const modalContent = document.createElement('div');
        modalContent.innerHTML = `
            <div class="modal fade" id="paymentSuccessModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header bg-success text-white">
                            <h5 class="modal-title"><i class="fas fa-check-circle me-2"></i> Payment Successful</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body text-center">
                            <div class="checkmark-circle">
                                <i class="fas fa-check"></i>
                            </div>
                            <h4 class="mt-4">Thank You!</h4>
                            <p id="paymentSuccessMessage">Your upgrade to the ${planName.charAt(0).toUpperCase() + planName.slice(1)} plan was successful.</p>
                            <div class="alert alert-info">
                                <strong>New limits:</strong>
                                <ul class="mb-0 mt-2 text-start">
                                    <li>Resume Analyses: <span id="newResumeLimit">${getPackageLimit(planName, 'resumeAnalyses')}</span></li>
                                    <li>Mock Interviews: <span id="newInterviewLimit">${getPackageLimit(planName, 'mockInterviews')}</span></li>
                                    <li>PDF Downloads: <span id="newPdfLimit">${getPackageLimit(planName, 'pdfDownloads')}</span></li>
                                    <li>AI Enhancements: <span id="newAiLimit">${getPackageLimit(planName, 'aiEnhance')}</span></li>
                                </ul>
                            </div>
                            <p class="text-muted mt-3">Order ID: ${data?.orderId || 'N/A'}<br>Payment ID: ${data?.paymentId || 'N/A'}</p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">Continue</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        console.log("[PAYMENT_DEBUG] Appending success modal to document body");
        document.body.appendChild(modalContent.firstElementChild);
        modalElement = document.getElementById('paymentSuccessModal');
        console.log(`[PAYMENT_DEBUG] Success modal element after creation: ${!!modalElement}`);
    }
    
    // Update content if needed
    const messageEl = document.getElementById('paymentSuccessMessage');
    if (messageEl) {
        console.log("[PAYMENT_DEBUG] Updating success message text");
        messageEl.textContent = `Your upgrade to the ${planName.charAt(0).toUpperCase() + planName.slice(1)} plan was successful.`;
    } else {
        console.warn("[PAYMENT_DEBUG] Success message element not found");
    }
    
    // Set limit values
    console.log("[PAYMENT_DEBUG] Setting limit values in success modal");
    setSuccessModalLimits(planName);
    
    // Initialize and show the modal safely
    try {
        console.log("[PAYMENT_DEBUG] Attempting to initialize Bootstrap modal");
        const modalInstance = new bootstrap.Modal(modalElement);
        console.log("[PAYMENT_DEBUG] Showing success modal");
        modalInstance.show();
        console.log("[PAYMENT_DEBUG] Success modal shown successfully");
    } catch (error) {
        console.error("[PAYMENT_DEBUG] Error showing payment success modal:", error);
        // Log DOM state for debugging
        console.log("[PAYMENT_DEBUG] Modal element:", modalElement);
        console.log("[PAYMENT_DEBUG] Document body children:", document.body.children.length);
        
        // Fallback message if modal fails
        showMessage(`Payment successful! Your plan has been upgraded to ${planName}.`, 'success');
    }
}

// Add this function to app.js - Modal fixes section with logging
function fixSvgAttributes() {
    console.log("[SVG_DEBUG] Starting SVG attribute fixes");
    let fixCount = 0;
    
    // Find all SVG elements with problematic attributes
    const svgElements = document.querySelectorAll('svg');
    console.log(`[SVG_DEBUG] Found ${svgElements.length} SVG elements to check`);
    
    svgElements.forEach((svg, index) => {
        const width = svg.getAttribute('width');
        const height = svg.getAttribute('height');
        const viewBox = svg.getAttribute('viewBox');
        
        console.log(`[SVG_DEBUG] SVG #${index} - width: ${width}, height: ${height}, viewBox: ${viewBox}`);
        
        // Fix width="auto" and height="auto" attributes
        if (width === 'auto') {
            svg.setAttribute('width', '100%');
            console.log(`[SVG_DEBUG] Fixed width="auto" on SVG #${index}`);
            fixCount++;
        }
        
        if (height === 'auto') {
            svg.setAttribute('height', '100%');
            console.log(`[SVG_DEBUG] Fixed height="auto" on SVG #${index}`);
            fixCount++;
        }
        
        // Ensure viewBox is set for proper scaling
        if (!viewBox) {
            // Set a default viewBox if none exists
            svg.setAttribute('viewBox', '0 0 24 24');
            console.log(`[SVG_DEBUG] Added missing viewBox to SVG #${index}`);
            fixCount++;
        }
        
        // Log the parent component for context
        const parentElement = svg.parentElement;
        if (parentElement) {
            console.log(`[SVG_DEBUG] SVG #${index} parent: ${parentElement.tagName}, class: ${parentElement.className}`);
        }
    });
    
    console.log(`[SVG_DEBUG] Completed SVG fixes. Fixed ${fixCount} attributes.`);
    return fixCount;
}


function patchAddonPurchaseModal() {
    // Preserve original function
    if (window.showAddonPurchaseModal) {
        window._originalShowAddonPurchaseModal = window.showAddonPurchaseModal;
    }
    
    // Replace with fixed version
    window.showAddonPurchaseModal = function(featureType = null) {
        // First clean up any existing modals
        safelyCloseModal('paymentProcessingModal');
        safelyCloseModal('paymentSuccessModal');
        safelyCloseModal('limitReachedModal');
        safelyCloseModal('addonPurchaseModal');
        
        const modal = document.getElementById('addonPurchaseModal');
        if (!modal) return;
        
        // If a specific feature was requested, focus on that card
        if (featureType) {
            // Scroll to and highlight that specific add-on card
            const featureCard = modal.querySelector(`.addon-purchase-btn[data-feature="${featureType}"]`)?.closest('.card');
            if (featureCard) {
                // Clear any existing highlights
                modal.querySelectorAll('.card').forEach(card => {
                    card.classList.remove('border-primary');
                });
                
                featureCard.classList.add('border-primary');
                setTimeout(() => {
                    featureCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            }
        }
        
        // Show the modal
        const modalInstance = new bootstrap.Modal(modal);
        modalInstance.show();
        
        // Enhance close button behavior
        const closeBtn = modal.querySelector('[data-bs-dismiss="modal"]');
        if (closeBtn) {
            // Clone to remove existing listeners
            const newCloseBtn = closeBtn.cloneNode(true);
            if (closeBtn.parentNode) {
                closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
            }
            
            newCloseBtn.addEventListener('click', function() {
                modalInstance.hide();
                setTimeout(() => {
                    safelyCloseModal('addonPurchaseModal');
                }, 300);
            });
        }
        
        // Add hidden event handler
        modal.addEventListener('hidden.bs.modal', function() {
            setTimeout(() => {
                safelyCloseModal('addonPurchaseModal');
            }, 300);
        }, { once: true });
    };
}

// Initialize all modal fixes 
function initModalFixes() {
    console.log("[INIT_DEBUG] Starting modal and UI fixes initialization");
    
    // Replace global functions with fixed versions
    window.safelyCloseModal = safelyCloseModal;
    window.showExistingUpgradeModal = showExistingUpgradeModal;
    window.selectPlan = selectPlanFixed; // Replace selectPlan
    console.log("[INIT_DEBUG] Global function replacements complete");
    
    // Add global cleanup mechanism
    setupGlobalModalCleanup();
    console.log("[INIT_DEBUG] Global modal cleanup mechanism set up");
    
    // Patch addon purchase modal
    patchAddonPurchaseModal();
    console.log("[INIT_DEBUG] Addon purchase modal patched");
    
    // Fix SVG attributes
    const fixCount = fixSvgAttributes();
    console.log(`[INIT_DEBUG] Initial SVG attribute fixes: ${fixCount}`);
    
    // Add observer to fix SVG attributes as they're added
    console.log("[INIT_DEBUG] Setting up MutationObserver for dynamic SVG fixes");
    const observer = new MutationObserver(mutations => {
        let svgNodesAdded = false;
        
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length) {
                // Check if any SVG elements were added
                mutation.addedNodes.forEach(node => {
                    if (node.nodeName === 'svg' || 
                        (node.nodeType === 1 && node.querySelector('svg'))) {
                        svgNodesAdded = true;
                    }
                });
            }
        });
        
        if (svgNodesAdded) {
            console.log("[SVG_DEBUG] New SVG elements detected in DOM");
            setTimeout(() => {
                const newFixCount = fixSvgAttributes();
                console.log(`[SVG_DEBUG] Fixed ${newFixCount} attributes on new SVG elements`);
            }, 100);
        }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    console.log("[INIT_DEBUG] MutationObserver started for SVG monitoring");
    
    console.log("[INIT_DEBUG] IRIS Modal Fixes initialized successfully!");
}


function initPublicJobListings() {
    console.log("Initializing public job listings");
    
    // Add a visible loading indicator for the entire tab
    const jobListingsTab = document.getElementById('job-listings-tab');
    if (jobListingsTab) {
        // Only add loading indicator if not already present
        if (!jobListingsTab.querySelector('.full-page-loader')) {
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'full-page-loader';
            loadingIndicator.innerHTML = `
                <div class="d-flex justify-content-center align-items-center" style="min-height: 300px;">
                    <div class="text-center">
                        <div class="spinner-border text-primary" role="status" style="width: 3rem; height: 3rem;">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <p class="mt-3">Loading job listings...</p>
                    </div>
                </div>
            `;
            jobListingsTab.appendChild(loadingIndicator);
        }
    }
    
    // Elements 
    const jobListingsGrid = document.getElementById('publicJobListingsGrid');
    const featuredJobsCarousel = document.getElementById('featuredJobsCarousel');
    const searchInput = document.getElementById('publicJobSearchInput');
    const categoryFilter = document.getElementById('publicJobCategoryFilter');
    const techFilter = document.getElementById('publicJobTechFilter');
    const resetFiltersBtn = document.getElementById('publicResetJobFilters');
    
    // Add event listeners for filtering before loading data
    if (searchInput) {
        // Remove existing listeners first to prevent duplicates
        const newSearchInput = searchInput.cloneNode(true);
        if (searchInput.parentNode) {
            searchInput.parentNode.replaceChild(newSearchInput, searchInput);
        }
        newSearchInput.addEventListener('input', function() {
            if (typeof filterPublicJobListings === 'function') {
                filterPublicJobListings();
            } else if (typeof filterJobListings === 'function') {
                filterJobListings();
            }
        });
    }
    
    if (categoryFilter) {
        const newCategoryFilter = categoryFilter.cloneNode(true);
        if (categoryFilter.parentNode) {
            categoryFilter.parentNode.replaceChild(newCategoryFilter, categoryFilter);
        }
        newCategoryFilter.addEventListener('change', function() {
            if (typeof filterPublicJobListings === 'function') {
                filterPublicJobListings();
            } else if (typeof filterJobListings === 'function') {
                filterJobListings();
            }
        });
    }
    
    if (techFilter) {
        const newTechFilter = techFilter.cloneNode(true);
        if (techFilter.parentNode) {
            techFilter.parentNode.replaceChild(newTechFilter, techFilter);
        }
        newTechFilter.addEventListener('change', function() {
            if (typeof filterPublicJobListings === 'function') {
                filterPublicJobListings();
            } else if (typeof filterJobListings === 'function') {
                filterJobListings();
            }
        });
    }
    
    if (resetFiltersBtn) {
        const newResetBtn = resetFiltersBtn.cloneNode(true);
        if (resetFiltersBtn.parentNode) {
            resetFiltersBtn.parentNode.replaceChild(newResetBtn, resetFiltersBtn);
        }
        newResetBtn.addEventListener('click', function() {
            if (typeof resetPublicFilters === 'function') {
                resetPublicFilters();
            } else if (typeof resetFilters === 'function') {
                resetFilters();
            }
        });
    }
    
    // Initialize - load the job listings
    // Use a small delay to ensure the UI is ready
    setTimeout(() => {
        loadPublicJobListingsOptimized();
    }, 100);
}

function loadPublicJobListingsOptimized() {
    console.log("Loading public job listings (optimized - without featured carousel)");
    
    if (!firebase.firestore) {
        console.error("Firestore not available");
        showErrorInPublicJobSection("Unable to load job listings at this time.");
        return;
    }
    
    // First, check if we're on the job listings page by looking for required elements
    const jobListingsGrid = document.getElementById('publicJobListingsGrid');
    if (!jobListingsGrid) {
        console.warn("Job listings grid not found, cannot load job listings");
        return;
    }
    
    // Remove references to the carousel
    const featuredJobsCarousel = null; // Don't use the carousel anymore
    
    // Show loading state for grid
    jobListingsGrid.innerHTML = `
        <div class="col-12 text-center py-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading jobs...</span>
            </div>
            <p class="mt-2">Loading job listings...</p>
        </div>
    `;
    
    // Get job listings collection with optimized query
    firebase.firestore().collection('jobPostings')
        .where('status', '==', 'active')
        .orderBy('postedDate', 'desc')
        .limit(50)
        .get()
        .then(snapshot => {
            console.log(`Received ${snapshot.size} job listings from Firestore`);
            
            // Remove the full page loading indicator if it exists
            const jobListingsTab = document.getElementById('job-listings-tab');
            const fullPageLoader = jobListingsTab?.querySelector('.full-page-loader');
            if (fullPageLoader) {
                fullPageLoader.remove();
            }
            
            if (snapshot.empty) {
                jobListingsGrid.innerHTML = `
                    <div class="col-12 text-center py-5">
                        <p class="text-muted">No job listings found.</p>
                    </div>
                `;
                return;
            }
            
            // Store jobs globally for filtering
            window.allJobs = [];
            
            // Process jobs with more efficient method
            const processStartTime = performance.now();
            const jobsData = snapshot.docs.map(doc => {
                const job = doc.data();
                job.id = doc.id; // Add document ID to job object
                return job;
            });
            
            // Assign to window.allJobs for filter functions to use
            window.allJobs = jobsData;
            
            console.log(`Processed ${jobsData.length} jobs in ${(performance.now() - processStartTime).toFixed(2)}ms`);
            
            try {
                // Populate filters
                const filtersStartTime = performance.now();
                if (typeof populateFilters === 'function') {
                    populateFilters(jobsData);
                } else if (typeof populateFilterOptions === 'function') {
                    populateFilterOptions();
                }
                console.log(`Populated filters in ${(performance.now() - filtersStartTime).toFixed(2)}ms`);
                
                // Display jobs with more efficient rendering
                const displayStartTime = performance.now();
                displayJobListingsEfficient(jobsData);
                console.log(`Displayed jobs in ${(performance.now() - displayStartTime).toFixed(2)}ms`);
                
                // We no longer initialize the carousel
            } catch (displayError) {
                console.error("Error displaying job listings:", displayError);
                jobListingsGrid.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>Error displaying job listings: ${displayError.message}
                    </div>
                `;
            }
            
            console.log(`Loaded ${jobsData.length} job listings successfully`);
            
            // Add this new code: Attach event listeners for Take Mock buttons
            const listenersStartTime = performance.now();
            if (typeof attachJobListingEventListeners === 'function') {
                attachJobListingEventListeners();
                console.log(`Attached event listeners in ${(performance.now() - listenersStartTime).toFixed(2)}ms`);
            }
        })
        .catch(error => {
            console.error("Error loading job listings:", error);
            
            // Remove the full page loading indicator if it exists
            const jobListingsTab = document.getElementById('job-listings-tab');
            const fullPageLoader = jobListingsTab?.querySelector('.full-page-loader');
            if (fullPageLoader) {
                fullPageLoader.remove();
            }
            
            jobListingsGrid.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>Error loading job listings: ${error.message}
                    </div>
                </div>
            `;
        });
}

// More efficient display function that uses document fragments for better performance
function displayJobListingsEfficient(jobs) {
    const jobListingsGrid = document.getElementById('publicJobListingsGrid');
    
    if (!jobListingsGrid) {
        console.error("Job listings grid not found");
        return;
    }
    
    // Clear the grid
    jobListingsGrid.innerHTML = '';
    
    if (!jobs || jobs.length === 0) {
        jobListingsGrid.innerHTML = `
            <div class="col-12 text-center py-5">
                <p class="text-muted">No job listings found matching your filters.</p>
            </div>
        `;
        return;
    }
    
    // Use document fragment for better performance
    const gridFragment = document.createDocumentFragment();
    
    // Create grid items
    jobs.forEach(job => {
        const gridCol = document.createElement('div');
        gridCol.className = 'col';
        gridCol.innerHTML = createJobCardHTML(job, false);
        gridFragment.appendChild(gridCol);
    });
    
    // Append all grid items at once
    jobListingsGrid.appendChild(gridFragment);
}

// Load job listings in the public view
function loadPublicJobListings() {
    if (!firebase.firestore) {
        console.error("Firestore not available");
        showErrorInPublicJobSection("Unable to load job listings at this time.");
        return;
    }
    
    // First, check if we're on the job listings page by looking for required elements
    const jobListingsGrid = document.getElementById('publicJobListingsGrid');
    if (!jobListingsGrid) {
        console.warn("Job listings grid not found, cannot load job listings");
        return;
    }
    
    // Get the carousel inner element, but don't fail if it doesn't exist
    const featuredJobsCarousel = document.getElementById('featuredJobsCarousel');
    const carouselInner = featuredJobsCarousel ? featuredJobsCarousel.querySelector('.carousel-inner') : null;
    
    // Show loading state for grid
    jobListingsGrid.innerHTML = `
        <div class="col-12 text-center py-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading jobs...</span>
            </div>
            <p class="mt-2">Loading job listings...</p>
        </div>
    `;
    
    // Show loading state for carousel if it exists
    if (carouselInner) {
        carouselInner.innerHTML = `
            <div class="carousel-item active">
                <div class="text-center py-5">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading jobs...</span>
                    </div>
                    <p class="mt-2">Loading featured jobs...</p>
                </div>
            </div>
        `;
    }
    
    // Get job listings collection
    firebase.firestore().collection('jobPostings')
        .where('status', '==', 'active')
        .orderBy('postedDate', 'desc')
        .limit(50)
        .get()
        .then(snapshot => {
            if (snapshot.empty) {
                jobListingsGrid.innerHTML = `
                    <div class="col-12 text-center py-5">
                        <p class="text-muted">No job listings found.</p>
                    </div>
                `;
                
                if (carouselInner) {
                    carouselInner.innerHTML = `
                        <div class="carousel-item active">
                            <div class="text-center py-5">
                                <p class="text-muted">No job listings found.</p>
                            </div>
                        </div>
                    `;
                }
                return;
            }
            
            // Store jobs globally for filtering
            window.allJobs = [];
            
            // Process jobs
            snapshot.forEach(doc => {
                const job = doc.data();
                job.id = doc.id; // Add document ID to job object
                window.allJobs.push(job);
            });
            
            try {
                // Populate filters
                if (typeof populateFilters === 'function') {
                    populateFilters(window.allJobs);
                } else if (typeof populateFilterOptions === 'function') {
                    populateFilterOptions();
                }
                
                // Display jobs
                if (typeof displayJobListings === 'function') {
                    displayJobListings(window.allJobs);
                } else {
                    console.error("displayJobListings function not found");
                    jobListingsGrid.innerHTML = '<div class="alert alert-danger">Error: Display function not found</div>';
                }
                
                // Initialize the carousel if it exists
                if (featuredJobsCarousel && typeof bootstrap !== 'undefined') {
                    try {
                        new bootstrap.Carousel(featuredJobsCarousel, {
                            interval: 5000 // 5 seconds per slide
                        });
                    } catch (carouselError) {
                        console.warn("Error initializing carousel:", carouselError);
                    }
                }
            } catch (displayError) {
                console.error("Error displaying job listings:", displayError);
                jobListingsGrid.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>Error displaying job listings: ${displayError.message}
                    </div>
                `;
            }
            
            console.log(`Loaded ${window.allJobs.length} job listings`);
            
            // Add this new code: Attach event listeners for Take Mock buttons
            setTimeout(() => {
                try {
                    if (typeof attachJobListingEventListeners === 'function') {
                        attachJobListingEventListeners();
                    }
                } catch (listenerError) {
                    console.error("Error attaching job listing event listeners:", listenerError);
                }
            }, 500);
        })
        .catch(error => {
            console.error("Error loading job listings:", error);
            jobListingsGrid.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>Error loading job listings: ${error.message}
                    </div>
                </div>
            `;
        });
}

// Helper function for showing errors in the job section
function showErrorInPublicJobSection(message) {
    const jobListingsGrid = document.getElementById('publicJobListingsGrid');
    if (jobListingsGrid) {
        jobListingsGrid.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>${message}
                </div>
            </div>
        `;
    }
    
    const featuredJobsCarousel = document.getElementById('featuredJobsCarousel');
    const carouselInner = featuredJobsCarousel ? featuredJobsCarousel.querySelector('.carousel-inner') : null;
    
    if (carouselInner) {
        carouselInner.innerHTML = `
            <div class="carousel-item active">
                <div class="alert alert-danger mx-3">
                    <i class="fas fa-exclamation-circle me-2"></i>${message}
                </div>
            </div>
        `;
    }
}

// Populate filter dropdowns
function populateFilters(jobs) {
    const categoryFilter = document.getElementById('jobCategoryFilter');
    const techFilter = document.getElementById('jobTechFilter');
    
    if (!categoryFilter || !techFilter) return;
    
    // Extract unique categories and tech stacks
    const categories = new Set();
    const techStacks = new Set();
    
    jobs.forEach(job => {
        if (job.category) categories.add(job.category);
        if (job.techStacks && Array.isArray(job.techStacks)) {
            job.techStacks.forEach(tech => techStacks.add(tech));
        }
    });
    
    // Populate category filter
    categoryFilter.innerHTML = '<option value="">All Categories</option>';
    Array.from(categories).sort().forEach(category => {
        categoryFilter.innerHTML += `<option value="${category}">${category}</option>`;
    });
    
    // Populate tech stack filter
    techFilter.innerHTML = '<option value="">All Tech Stacks</option>';
    Array.from(techStacks).sort().forEach(tech => {
        techFilter.innerHTML += `<option value="${tech}">${tech}</option>`;
    });
}

// Display job listings in both grid and carousel
function displayJobListings(jobs) {
    const jobListingsGrid = document.getElementById('jobListingsGrid');
    const carouselInner = document.querySelector('#jobListingsCarousel .carousel-inner');
    
    if (!jobListingsGrid || !carouselInner) return;
    
    // Clear previous content
    jobListingsGrid.innerHTML = '';
    carouselInner.innerHTML = '';
    
    if (jobs.length === 0) {
        jobListingsGrid.innerHTML = `
            <div class="col-12 text-center py-5">
                <p class="text-muted">No job listings found matching your filters.</p>
            </div>
        `;
        carouselInner.innerHTML = `
            <div class="carousel-item active">
                <div class="text-center py-5">
                    <p class="text-muted">No job listings found matching your filters.</p>
                </div>
            </div>
        `;
        return;
    }
    
    // Prepare carousel items (3 jobs per slide)
    const carouselChunks = chunkArray(jobs.slice(0, 9), 3); // Only first 9 for carousel
    
    // Create carousel items
    carouselChunks.forEach((chunk, index) => {
        const carouselItem = document.createElement('div');
        carouselItem.className = `carousel-item ${index === 0 ? 'active' : ''}`;
        
        const carouselRow = document.createElement('div');
        carouselRow.className = 'row mx-0';
        
        chunk.forEach(job => {
            const cardCol = document.createElement('div');
            cardCol.className = 'col-md-4';
            cardCol.innerHTML = createJobCardHTML(job, true);
            carouselRow.appendChild(cardCol);
        });
        
        carouselItem.appendChild(carouselRow);
        carouselInner.appendChild(carouselItem);
    });
    
    // Create grid items
    jobs.forEach(job => {
        const gridCol = document.createElement('div');
        gridCol.className = 'col';
        gridCol.innerHTML = createJobCardHTML(job, false);
        jobListingsGrid.appendChild(gridCol);
    });
    
    // Add event listeners to "Know More" buttons
    document.querySelectorAll('.view-job-details-btn').forEach(button => {
        button.addEventListener('click', function() {
            const jobId = this.getAttribute('data-job-id');
            showJobDetails(jobId);
        });
    });
    
    // Add event listeners to "Take Mock" buttons
    document.querySelectorAll('.take-mock-interview-btn').forEach(button => {
        button.addEventListener('click', function() {
            const jobId = this.getAttribute('data-job-id');
            takeMockInterview(jobId);
        });
    });
}

// Create HTML for a job card
function createJobCardHTML(job, isCarousel) {
    if (!job || !job.id) {
        console.warn("Job data missing ID:", job);
    }
    
    const jobId = job.id || 'unknown';
    const cardClass = isCarousel ? 'carousel-job-card' : '';
    const logoUrl = job.companyLogoUrl || 'images/default-company-logo.png'; // Fallback logo
    const postedDate = formatDate(job.postedDate);
    
    // Limit tech stacks to 3 for display
    const techStacksHtml = job.techStacks && job.techStacks.length > 0
        ? job.techStacks.slice(0, 3).map(tech => `<span class="tech-badge">${tech}</span>`).join('')
        : '';
    
    // Show +X more if there are more tech stacks
    const moreStacksHtml = job.techStacks && job.techStacks.length > 3
        ? `<span class="tech-badge">+${job.techStacks.length - 3} more</span>`
        : '';
    
    return `
        <div class="card job-card ${cardClass}">
            <span class="job-status-badge badge bg-success">Active</span>
            <img src="${logoUrl}" class="card-img-top" alt="${job.companyName || 'Company'} logo" onerror="this.src='images/default-company-logo.png';this.onerror='';">
            <div class="card-body d-flex flex-column">
                <h5 class="card-title">${job.title || 'Job Title'}</h5>
                <h6 class="card-subtitle mb-2 text-muted">${job.companyName || 'Company'}</h6>
                <p class="card-text">
                    <i class="fas fa-map-marker-alt me-2"></i>${job.location || 'Location'}<br>
                    <span class="posted-date"><i class="far fa-calendar-alt me-1"></i>Posted: ${postedDate}</span>
                </p>
                <div class="tech-stack mb-3">
                    ${techStacksHtml}
                    ${moreStacksHtml}
                </div>
                <div class="mt-auto d-flex">
                    <button class="btn btn-outline-primary me-2 view-job-details-btn" data-job-id="${jobId}" onclick="showJobDetails('${jobId}')">
                        <i class="fas fa-info-circle me-1"></i> Know More
                    </button>
                    <button class="btn btn-primary take-mock-interview-btn" data-job-id="${jobId}" onclick="takeMockInterview('${jobId}')">
                        <i class="fas fa-microphone-alt me-1"></i> Take Mock
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Show job details in modal
function showJobDetails(jobId) {
    if (!jobId) {
        console.error("showJobDetails called with no jobId");
        return;
    }
    console.log(`Showing details for job ID: ${jobId}`);
    
    // Get the modal elements
    const modal = document.getElementById('jobDetailsModal');
    const contentDiv = document.getElementById('jobDetailsContent');
    const modalTitle = document.getElementById('jobDetailsModalLabel');
    const takeMockBtn = document.getElementById('takeMockInterviewBtn');
    
    if (!modal || !contentDiv) {
        console.error("Job details modal elements not found");
        alert("Cannot display job details. Please try again later.");
        return;
    }
    
    // Show loading state
    contentDiv.innerHTML = `
        <div class="text-center py-3">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading job details...</span>
            </div>
            <p class="mt-2">Loading job details...</p>
        </div>
    `;
    
    // Set job ID on the Take Mock button if it exists
    if (takeMockBtn) {
        takeMockBtn.setAttribute('data-job-id', jobId);
    }
    
    // Initialize Bootstrap modal and show it
    try {
        const modalInstance = new bootstrap.Modal(modal);
        modalInstance.show();
    } catch (error) {
        console.error("Error showing modal:", error);
        // Try an alternative approach if the first fails
        if (typeof bootstrap !== 'undefined') {
            try {
                bootstrap.Modal.getInstance(modal)?.show();
            } catch (err) {
                console.error("Both modal show methods failed:", err);
                // Last resort: vanilla JS
                modal.style.display = 'block';
                modal.classList.add('show');
            }
        }
    }
    
    // Fetch job details
    firebase.firestore().collection('jobPostings').doc(jobId).get()
        .then(doc => {
            if (!doc.exists) {
                contentDiv.innerHTML = `<div class="alert alert-danger">Job listing not found.</div>`;
                return;
            }
            
            const job = doc.data();
            job.id = doc.id;
            
            // Format date
            const postedDate = formatDate(job.postedDate);
            const expiryDate = formatDate(job.expiryDate);
            
            // Update modal title
            if (modalTitle) {
                modalTitle.textContent = job.title || 'Job Details';
            }
            
            // Generate tech stacks HTML
            const techStacksHtml = job.techStacks && job.techStacks.length > 0
                ? job.techStacks.map(tech => `<span class="tech-badge">${tech}</span>`).join('')
                : '<span class="text-muted">No specific tech stacks listed</span>';
            
            // Generate interview questions HTML
            const questionsHtml = job.previousInterviewQuestions && job.previousInterviewQuestions.length > 0
                ? `
                    <div class="interview-questions">
                        <h5><i class="fas fa-question-circle me-2"></i>Sample Interview Questions</h5>
                        <ul>
                            ${job.previousInterviewQuestions.map(q => `<li>${q}</li>`).join('')}
                        </ul>
                    </div>
                `
                : '';
            
            // Custom fields HTML
            let customFieldsHtml = '';
            if (job.customFields && Object.keys(job.customFields).length > 0) {
                customFieldsHtml = `
                    <div class="custom-fields mt-4">
                        <h5 class="section-title">Additional Information</h5>
                        <ul class="list-group">
                            ${Object.entries(job.customFields).map(([key, value]) => 
                                `<li class="list-group-item d-flex justify-content-between align-items-center">
                                    <span class="fw-medium">${key}</span>
                                    <span>${value}</span>
                                </li>`
                            ).join('')}
                        </ul>
                    </div>
                `;
            }
            
            // Source link HTML
            const sourceLinkHtml = job.sourceLink
                ? `
                    <div class="source-link">
                        <a href="${job.sourceLink}" target="_blank" class="btn btn-outline-secondary">
                            <i class="fas fa-external-link-alt me-2"></i>View Original Job Posting
                        </a>
                    </div>
                `
                : '';
            
            // Generate full job details HTML
            contentDiv.innerHTML = `
                <div class="company-header">
                    <img src="${job.companyLogoUrl || 'images/default-company-logo.png'}" class="company-logo" alt="${job.companyName || 'Company'} logo" onerror="this.src='images/default-company-logo.png';this.onerror='';">
                    <div>
                        <h4>${job.companyName || 'Company'}</h4>
                        <p class="text-muted mb-0">${job.location || 'Location'}</p>
                    </div>
                </div>
                
                <div class="job-meta">
                    <div class="job-meta-item">
                        <i class="fas fa-briefcase"></i>
                        <span>${job.experienceLevel || 'Experience not specified'}</span>
                    </div>
                    <div class="job-meta-item">
                        <i class="far fa-calendar-alt"></i>
                        <span>Posted: ${postedDate}</span>
                    </div>
                    ${job.salaryRange ? `
                        <div class="job-meta-item">
                            <i class="fas fa-money-bill-wave"></i>
                            <span>${job.salaryRange}</span>
                        </div>
                    ` : ''}
                    ${job.relocation ? `
                        <div class="job-meta-item">
                            <i class="fas fa-plane-departure"></i>
                            <span>Relocation Offered</span>
                        </div>
                    ` : ''}
                </div>
                
                <h5 class="section-title">Job Description</h5>
                <div class="description-text">
                    ${job.description || 'No description provided.'}
                </div>
                
                <h5 class="section-title">Requirements</h5>
                <div class="requirements-list">
                    ${job.requirements || 'No specific requirements listed.'}
                </div>
                
                <h5 class="section-title">Tech Stack</h5>
                <div class="tech-stacks">
                    ${techStacksHtml}
                </div>
                
                ${questionsHtml}
                ${customFieldsHtml}
                ${sourceLinkHtml}
            `;
        })
        .catch(error => {
            console.error("Error fetching job details:", error);
            contentDiv.innerHTML = `<div class="alert alert-danger">Error loading job details. Please try again later.</div>`;
        });
}

// Helper function to format date from Firestore timestamp
function formatDate(timestampOrDate) {
    if (!timestampOrDate) return 'N/A';
    
    try {
        let date;
        if (typeof timestampOrDate.toDate === 'function') {
            // It's a Firestore timestamp
            date = timestampOrDate.toDate();
        } else if (timestampOrDate instanceof Date) {
            // It's already a Date object
            date = timestampOrDate;
        } else if (typeof timestampOrDate === 'string') {
            // It's a date string
            date = new Date(timestampOrDate);
        } else if (typeof timestampOrDate === 'number') {
            // It's a timestamp in milliseconds
            date = new Date(timestampOrDate);
        } else {
            // Unknown format
            return 'N/A';
        }
        
        // Format the date
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        console.warn("Error formatting date:", error);
        return 'N/A';
    }
}

// Take Mock Interview function
function takeMockInterview(jobId) {
    if (!jobId) {
        console.error("takeMockInterview called with no jobId");
        showMessage("Error: Job ID not found", "danger");
        return;
    }

    console.log(`Taking mock interview for job ID: ${jobId}`);
    
    // First check if user is logged in
    const user = firebase.auth().currentUser;
    if (!user) {
        console.log("User not logged in, storing job ID and showing sign up modal");
        
        // Close job details modal if open (with improved error handling)
        try {
            const jobModal = document.getElementById('jobDetailsModal');
            if (jobModal) {
                const modalInstance = bootstrap.Modal.getInstance(jobModal);
                if (modalInstance) {
                    modalInstance.hide();
                    // Remove modal backdrop forcefully
                    setTimeout(() => {
                        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
                        document.body.classList.remove('modal-open');
                        document.body.style.removeProperty('padding-right');
                        document.body.style.overflow = '';
                    }, 300);
                }
            }
        } catch (modalError) {
            console.warn("Error closing job details modal:", modalError);
            // Force cleanup of modals
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('padding-right');
            document.body.style.overflow = '';
        }
        
        // Store job ID in localStorage for retrieval after login
        localStorage.setItem('pendingMockInterviewJobId', jobId);
        
        // Show sign in/sign up modal
        if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignUpModal === 'function') {
            // Show sign up modal instead of sign in for better conversion
            irisAuth.showSignUpModal();
            // Add a message to the sign-up modal
            setTimeout(() => {
                try {
                    const authForm = document.getElementById('signup-form');
                    if (authForm) {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'alert alert-info mb-3';
                        messageDiv.innerHTML = `<i class="fas fa-info-circle me-2"></i>Sign up to practice mock interviews for this job.`;
                        authForm.insertBefore(messageDiv, authForm.firstChild);
                    }
                } catch (authFormError) {
                    console.warn("Error adding message to auth form:", authFormError);
                }
            }, 300);
        } else {
            console.warn("irisAuth.showSignUpModal not available");
            showMessage("Please sign in to take mock interviews", "info");
        }
        return;
    }
    
    // Close job details modal if open (with improved error handling)
    try {
        const jobModal = document.getElementById('jobDetailsModal');
        if (jobModal) {
            const modalInstance = bootstrap.Modal.getInstance(jobModal);
            if (modalInstance) {
                modalInstance.hide();
                // Remove modal backdrop forcefully
                setTimeout(() => {
                    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
                    document.body.classList.remove('modal-open');
                    document.body.style.removeProperty('padding-right');
                    document.body.style.overflow = '';
                }, 300);
            }
        }
    } catch (modalError) {
        console.warn("Error closing job details modal:", modalError);
        // Force cleanup of modals
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('padding-right');
        document.body.style.overflow = '';
    }
    
    // Show loading message
    if (typeof showMessage === 'function') {
        showMessage("Loading job details for interview...", "info");
    }
    
    console.log("Fetching job details from Firestore");
    
    // Fetch job details to get the job description
    firebase.firestore().collection('jobPostings').doc(jobId).get()
        .then(doc => {
            if (!doc.exists) {
                console.error("Job document not found:", jobId);
                if (typeof showMessage === 'function') {
                    showMessage("Job listing not found.", "danger");
                }
                return;
            }
            
            const job = doc.data();
            console.log("Retrieved job data for interview:", job);
            
            // Navigate to the resume upload section
            if (typeof navigateTo === 'function') {
                navigateTo('upload');
            } else {
                console.error("navigateTo function not found");
                return;
            }
            
            // Pre-fill job description
            const jobDescTextarea = document.getElementById('jobDescription');
            if (jobDescTextarea) {
                // Format job details into a comprehensive job description
                const jobDesc = formatJobToDescription(job);
                jobDescTextarea.value = jobDesc;
                
                // Focus on file upload since JD is already filled
                const resumeFileInput = document.getElementById('resumeFile');
                if (resumeFileInput) {
                    setTimeout(() => {
                        resumeFileInput.focus();
                        if (typeof showMessage === 'function') {
                            showMessage("Job description loaded. Please upload your resume to continue.", "success");
                        }
                    }, 300);
                }
            } else {
                console.error("Could not find jobDescription textarea in the upload section");
                if (typeof showMessage === 'function') {
                    showMessage("Error: Could not find job description input field", "warning");
                }
            }
        })
        .catch(error => {
            console.error("Error fetching job details for interview:", error);
            if (typeof showMessage === 'function') {
                showMessage("Error loading job details. Please try again later.", "danger");
            }
        });
}



function formatJobToDescription(job) {
    try {
        // Create a structured job description from the job fields
        let jobDesc = `${job.title || 'Job'} at ${job.companyName || 'Company'}\n\n`;
        
        jobDesc += `Location: ${job.location || 'Not specified'}\n`;
        jobDesc += `Experience: ${job.experienceLevel || 'Not specified'}\n`;
        if (job.salaryRange) jobDesc += `Salary: ${job.salaryRange}\n`;
        if (job.relocation) jobDesc += `Relocation: Offered\n`;
        if (job.category && job.subCategory) jobDesc += `Category: ${job.category} / ${job.subCategory}\n`;
        
        jobDesc += `\nJOB DESCRIPTION:\n${job.description || 'No description provided.'}\n`;
        
        jobDesc += `\nREQUIREMENTS:\n${job.requirements || 'No specific requirements listed.'}\n`;
        
        if (job.techStacks && job.techStacks.length > 0) {
            jobDesc += `\nTECH STACK: ${job.techStacks.join(', ')}\n`;
        }
        
        // Add custom fields if any
        if (job.customFields && Object.keys(job.customFields).length > 0) {
            jobDesc += `\nADDITIONAL INFORMATION:\n`;
            Object.entries(job.customFields).forEach(([key, value]) => {
                jobDesc += `${key}: ${value}\n`;
            });
        }
        
        return jobDesc;
    } catch (error) {
        console.error("Error formatting job description:", error);
        // Return a simple fallback description if there's an error
        return `${job?.title || 'Job Position'} at ${job?.companyName || 'Company'}\n\n${job?.description || 'Please check job details.'}\n\n${job?.requirements || ''}`;
    }
}

// Filter job listings based on search and filter inputs
function filterJobListings() {
    const searchInput = document.getElementById('jobSearchInput');
    const categoryFilter = document.getElementById('jobCategoryFilter');
    const techFilter = document.getElementById('jobTechFilter');
    
    if (!window.allJobs || !Array.isArray(window.allJobs)) {
        console.error("Job listings not loaded yet");
        return;
    }
    
    // Get filter values
    const searchTerm = searchInput?.value?.toLowerCase() || '';
    const categoryValue = categoryFilter?.value || '';
    const techValue = techFilter?.value || '';
    
    // Filter jobs
    const filteredJobs = window.allJobs.filter(job => {
        // Search term filter
        const searchMatch = !searchTerm || 
            (job.title && job.title.toLowerCase().includes(searchTerm)) ||
            (job.companyName && job.companyName.toLowerCase().includes(searchTerm)) ||
            (job.location && job.location.toLowerCase().includes(searchTerm)) ||
            (job.description && job.description.toLowerCase().includes(searchTerm));
        
        // Category filter
        const categoryMatch = !categoryValue || (job.category === categoryValue);
        
        // Tech stack filter
        const techMatch = !techValue || 
            (job.techStacks && Array.isArray(job.techStacks) && 
             job.techStacks.some(tech => tech.toLowerCase() === techValue.toLowerCase()));
        
        return searchMatch && categoryMatch && techMatch;
    });
    
    // Display filtered jobs
    displayJobListings(filteredJobs);
}

// Reset all filters
function resetFilters() {
    const searchInput = document.getElementById('jobSearchInput');
    const categoryFilter = document.getElementById('jobCategoryFilter');
    const techFilter = document.getElementById('jobTechFilter');
    
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = '';
    if (techFilter) techFilter.value = '';
    
    // Display all jobs
    if (window.allJobs && Array.isArray(window.allJobs)) {
        displayJobListings(window.allJobs);
    } else {
        // If allJobs is not available, reload from Firebase
        loadJobListings();
    }
}

// Helper function to show errors in job section
function showErrorInJobSection(message) {
    const jobListingsGrid = document.getElementById('jobListingsGrid');
    const carouselInner = document.querySelector('#jobListingsCarousel .carousel-inner');
    
    if (jobListingsGrid) {
        jobListingsGrid.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>${message}
                </div>
            </div>
        `;
    }
    
    if (carouselInner) {
        carouselInner.innerHTML = `
            <div class="carousel-item active">
                <div class="alert alert-danger mx-3">
                    <i class="fas fa-exclamation-circle me-2"></i>${message}
                </div>
            </div>
        `;
    }
}

// Helper function to split array into chunks
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

// Check and process pending mock interview after login
function checkPendingMockInterview() {
    const pendingJobId = localStorage.getItem('pendingMockInterviewJobId');
    if (!pendingJobId) {
        return; // No pending interview
    }
    
    console.log("Found pending mock interview job ID:", pendingJobId);
    
    // Clear from storage to prevent repeats
    localStorage.removeItem('pendingMockInterviewJobId');
    
    // Check if user is now logged in
    if (firebase.auth().currentUser) {
        console.log("User is logged in, proceeding with mock interview for job:", pendingJobId);
        
        // Force clean up any UI/modal issues
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('padding-right');
        document.body.style.overflow = '';
        
        // Small delay to ensure everything is loaded
        setTimeout(() => {
            takeMockInterview(pendingJobId);
        }, 1000);
    }
}

function filterPublicJobListings() {
    const searchInput = document.getElementById('publicJobSearchInput');
    const categoryFilter = document.getElementById('publicJobCategoryFilter');
    const techFilter = document.getElementById('publicJobTechFilter');
    
    if (!window.allJobs || !Array.isArray(window.allJobs)) {
        console.error("Job listings not loaded yet");
        return;
    }
    
    // Get filter values
    const searchTerm = searchInput?.value?.toLowerCase() || '';
    const categoryValue = categoryFilter?.value || '';
    const techValue = techFilter?.value || '';
    
    // Filter jobs
    const filteredJobs = window.allJobs.filter(job => {
        // Search term filter
        const searchMatch = !searchTerm || 
            (job.title && job.title.toLowerCase().includes(searchTerm)) ||
            (job.companyName && job.companyName.toLowerCase().includes(searchTerm)) ||
            (job.location && job.location.toLowerCase().includes(searchTerm)) ||
            (job.description && job.description.toLowerCase().includes(searchTerm));
        
        // Category filter
        const categoryMatch = !categoryValue || (job.category === categoryValue);
        
        // Tech stack filter
        const techMatch = !techValue || 
            (job.techStacks && Array.isArray(job.techStacks) && 
             job.techStacks.some(tech => tech.toLowerCase() === techValue.toLowerCase()));
        
        return searchMatch && categoryMatch && techMatch;
    });
    
    // Display filtered jobs
    displayJobListingsEfficient(filteredJobs);
    
    // Reattach event listeners to the newly created job cards
    setTimeout(() => {
        if (typeof attachJobListingEventListeners === 'function') {
            attachJobListingEventListeners();
        }
    }, 100);
}

function resetPublicFilters() {
    const searchInput = document.getElementById('publicJobSearchInput');
    const categoryFilter = document.getElementById('publicJobCategoryFilter');
    const techFilter = document.getElementById('publicJobTechFilter');
    
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = '';
    if (techFilter) techFilter.value = '';
    
    // Display all jobs
    if (window.allJobs && Array.isArray(window.allJobs)) {
        displayJobListingsEfficient(window.allJobs);
        
        // Reattach event listeners
        setTimeout(() => {
            if (typeof attachJobListingEventListeners === 'function') {
                attachJobListingEventListeners();
            }
        }, 100);
    } else {
        // If allJobs is not available, reload from Firebase
        loadPublicJobListingsOptimized();
    }
}                                                   




function debugJobListingDisplay() {
  console.log("--- Job Listing Debug Information ---");
  
  // Check main container
  const publicJobListingsGrid = document.getElementById('publicJobListingsGrid');
  console.log("publicJobListingsGrid exists:", !!publicJobListingsGrid);
  
  if (publicJobListingsGrid) {
    console.log("publicJobListingsGrid innerHTML:", publicJobListingsGrid.innerHTML.substring(0, 100) + "...");
  }
  
  // Check if we're actually loading jobs properly
  console.log("window.allJobs:", window.allJobs ? `Array with ${window.allJobs.length} items` : "undefined");
  
  if (window.allJobs && window.allJobs.length > 0) {
    console.log("First job in allJobs:", {
      title: window.allJobs[0].title,
      company: window.allJobs[0].companyName,
      id: window.allJobs[0].id
    });
  }
  
  // Check displayJobListings function
  console.log("displayJobListings function exists:", typeof displayJobListings === "function");
  
  // Check other key elements
  const featuredCarousel = document.getElementById('featuredJobsCarousel');
  console.log("featuredJobsCarousel exists:", !!featuredCarousel);
  
  // Fix the job listing display function if needed
  fixJobListingDisplay();
}

// Now let's fix the display function
function fixJobListingDisplay() {
  // Make sure allJobs is defined
  if (!window.allJobs || !Array.isArray(window.allJobs)) {
    console.warn("No jobs loaded yet to display");
    return;
  }
  
  // Check both potential element IDs for the job listings grid
  const publicJobListingsGrid = document.getElementById('publicJobListingsGrid');
  
  if (!publicJobListingsGrid) {
    console.error("Job listings container element not found");
    return;
  }
  
  // Clear any existing loading indicator
  publicJobListingsGrid.innerHTML = '';
  
  if (window.allJobs.length === 0) {
    publicJobListingsGrid.innerHTML = `
      <div class="col-12 text-center py-5">
        <p class="text-muted">No job listings found matching your filters.</p>
      </div>
    `;
    return;
  }
  
  // Create HTML for each job card
  window.allJobs.forEach(job => {
    const jobCard = createJobCardHTML(job, false);
    const gridCol = document.createElement('div');
    gridCol.className = 'col';
    gridCol.innerHTML = jobCard;
    publicJobListingsGrid.appendChild(gridCol);
  });
  
  // Add event handlers to the newly created cards
  document.querySelectorAll('.view-job-details-btn').forEach(button => {
    button.addEventListener('click', function() {
      const jobId = this.getAttribute('data-job-id');
      if (typeof showJobDetails === 'function') {
        showJobDetails(jobId);
      } else {
        console.error("showJobDetails function is not defined");
      }
    });
  });
  
  document.querySelectorAll('.take-mock-interview-btn').forEach(button => {
    button.addEventListener('click', function() {
      const jobId = this.getAttribute('data-job-id');
      if (typeof takeMockInterview === 'function') {
        takeMockInterview(jobId);
      } else {
        console.error("takeMockInterview function is not defined");
      }
    });
  });
  
  // Also update the featured carousel if it exists
  updateFeaturedCarousel();
}

// Helper function to create job card HTML
function createJobCardHTML(job, isCarousel) {
    const cardClass = isCarousel ? 'carousel-job-card' : '';
    const logoUrl = job.companyLogoUrl || 'images/default-company-logo.png'; // Fallback logo
    
    // Format posted date
    let postedDate = 'N/A';
    if (job.postedDate) {
        try {
            if (typeof job.postedDate.toDate === 'function') {
                postedDate = job.postedDate.toDate().toLocaleDateString();
            } else if (job.postedDate instanceof Date) {
                postedDate = job.postedDate.toLocaleDateString();
            } else if (typeof job.postedDate === 'string') {
                postedDate = new Date(job.postedDate).toLocaleDateString();
            }
        } catch (e) {
            console.warn("Error formatting date:", e);
        }
    }
    
    // Limit tech stacks to 3 for display
    const techStacksHtml = job.techStacks && job.techStacks.length > 0
        ? job.techStacks.slice(0, 3).map(tech => `<span class="tech-badge">${tech}</span>`).join('')
        : '';
    
    // Show +X more if there are more tech stacks
    const moreStacksHtml = job.techStacks && job.techStacks.length > 3
        ? `<span class="tech-badge">+${job.techStacks.length - 3} more</span>`
        : '';
    
    return `
        <div class="card job-card ${cardClass}">
            <span class="job-status-badge badge bg-success">Active</span>
            <img src="${logoUrl}" class="card-img-top" alt="${job.companyName || 'Company'} logo" onerror="this.src='images/default-company-logo.png';this.onerror='';">
            <div class="card-body d-flex flex-column">
                <h5 class="card-title">${job.title || 'Job Title'}</h5>
                <h6 class="card-subtitle mb-2 text-muted">${job.companyName || 'Company'}</h6>
                <p class="card-text">
                    <i class="fas fa-map-marker-alt me-2"></i>${job.location || 'Location'}<br>
                    <span class="posted-date"><i class="far fa-calendar-alt me-1"></i>Posted: ${postedDate}</span>
                </p>
                <div class="tech-stack mb-3">
                    ${techStacksHtml}
                    ${moreStacksHtml}
                </div>
                <div class="mt-auto d-flex">
                    <button class="btn btn-outline-primary me-2 view-job-details-btn" data-job-id="${job.id}">
                        <i class="fas fa-info-circle me-1"></i> Know More
                    </button>
                    <button class="btn btn-primary take-mock-interview-btn" data-job-id="${job.id}">
                        <i class="fas fa-microphone-alt me-1"></i> Take Mock
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Update the featured carousel
function updateFeaturedCarousel() {
  const carouselInner = document.querySelector('#featuredJobsCarousel .carousel-inner');
  if (!carouselInner || !window.allJobs || !window.allJobs.length) return;
  
  carouselInner.innerHTML = '';
  
  // Take at most 9 jobs for featured carousel
  const featuredJobs = window.allJobs.slice(0, 9);
  
  // Group into chunks of 3 for carousel slides
  const groupSize = 3;
  for (let i = 0; i < featuredJobs.length; i += groupSize) {
    const jobGroup = featuredJobs.slice(i, i + groupSize);
    const isActive = i === 0;
    
    const carouselItem = document.createElement('div');
    carouselItem.className = `carousel-item ${isActive ? 'active' : ''}`;
    
    const row = document.createElement('div');
    row.className = 'row mx-0';
    
    jobGroup.forEach(job => {
      const col = document.createElement('div');
      col.className = 'col-md-4';
      col.innerHTML = createJobCardHTML(job, true);
      row.appendChild(col);
    });
    
    carouselItem.appendChild(row);
    carouselInner.appendChild(carouselItem);
  }
  
  // Initialize the carousel
  const carousel = document.getElementById('featuredJobsCarousel');
  if (carousel && typeof bootstrap !== 'undefined') {
    new bootstrap.Carousel(carousel, {
      interval: 5000
    });
  }
}

// Fix for the loadPublicJobListings function
function fixLoadPublicJobListings() {
  // First check if we're on the public page section
  const publicJobListingsGrid = document.getElementById('publicJobListingsGrid');
  const featuredJobsCarousel = document.getElementById('featuredJobsCarousel');
  
  if (!publicJobListingsGrid || !featuredJobsCarousel) {
    console.log("Not on the job listings page, skipping load");
    return;
  }
  
  // Show loading state
  publicJobListingsGrid.innerHTML = `
    <div class="col-12 text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading jobs...</span>
      </div>
      <p class="mt-2">Loading job listings...</p>
    </div>
  `;
  
  featuredJobsCarousel.querySelector('.carousel-inner').innerHTML = `
    <div class="carousel-item active">
      <div class="text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading jobs...</span>
        </div>
        <p class="mt-2">Loading featured jobs...</p>
      </div>
    </div>
  `;
  
  // Load jobs from Firebase
  if (typeof firebase !== 'undefined' && firebase.firestore) {
    firebase.firestore().collection('jobPostings')
      .where('status', '==', 'active')
      .orderBy('postedDate', 'desc')
      .limit(50)
      .get()
      .then(snapshot => {
        window.allJobs = [];
        
        snapshot.forEach(doc => {
          const job = doc.data();
          job.id = doc.id;
          window.allJobs.push(job);
        });
        
        console.log(`Loaded ${window.allJobs.length} job listings`);
        
        // Display the jobs
        fixJobListingDisplay();
        
        // Populate filter options
        populateFilterOptions();
      })
      .catch(error => {
        console.error("Error loading job listings:", error);
        publicJobListingsGrid.innerHTML = `
          <div class="col-12">
            <div class="alert alert-danger">
              <i class="fas fa-exclamation-circle me-2"></i>Error loading job listings: ${error.message}
            </div>
          </div>
        `;
      });
  } else {
    console.error("Firebase or Firestore not available");
    publicJobListingsGrid.innerHTML = `
      <div class="col-12">
        <div class="alert alert-danger">
          <i class="fas fa-exclamation-circle me-2"></i>Database not available
        </div>
      </div>
    `;
  }
}

// Populate filter dropdown options
function populateFilterOptions() {
  if (!window.allJobs || !window.allJobs.length) return;
  
  const categoryFilter = document.getElementById('publicJobCategoryFilter');
  const techFilter = document.getElementById('publicJobTechFilter');
  
  if (!categoryFilter || !techFilter) return;
  
  // Extract unique categories and tech stacks
  const categories = new Set();
  const techStacks = new Set();
  
  window.allJobs.forEach(job => {
    if (job.category) categories.add(job.category);
    if (job.techStacks && Array.isArray(job.techStacks)) {
      job.techStacks.forEach(tech => techStacks.add(tech));
    }
  });
  
  // Populate category filter
  categoryFilter.innerHTML = '<option value="">All Categories</option>';
  Array.from(categories).sort().forEach(category => {
    categoryFilter.innerHTML += `<option value="${category}">${category}</option>`;
  });
  
  // Populate tech stack filter
  techFilter.innerHTML = '<option value="">All Tech Stacks</option>';
  Array.from(techStacks).sort().forEach(tech => {
    techFilter.innerHTML += `<option value="${tech}">${tech}</option>`;
  });
}

// Ensure this listener gets attached to job listing cards
function attachJobListingEventListeners() {
    console.log("Attaching job listing event listeners");
    
    // For debugging: print all buttons before attaching
    console.log("Debug - All buttons in DOM:");
    console.log("- Take Mock buttons:", document.querySelectorAll('.take-mock-interview-btn').length);
    console.log("- Know More buttons:", document.querySelectorAll('.view-job-details-btn').length);
    
    // Add event listeners to "Know More" buttons in job cards
    const detailButtons = document.querySelectorAll('.view-job-details-btn');
    console.log(`Found ${detailButtons.length} 'Know More' buttons to attach listeners to`);
    
    detailButtons.forEach((button, index) => {
        // First remove any existing listeners by cloning and replacing the button
        const newButton = button.cloneNode(true);
        if (button.parentNode) {
            button.parentNode.replaceChild(newButton, button);
        }
        
        // Add fresh event listener with console logs
        newButton.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent default if it's an anchor
            console.log(`Know More button clicked (button ${index + 1})`);
            
            const jobId = this.getAttribute('data-job-id');
            if (jobId) {
                console.log(`Know More clicked for job ID: ${jobId} (button ${index + 1})`);
                showJobDetails(jobId); // Call our fixed function
            } else {
                console.error(`No job ID found on Know More button ${index + 1}`);
            }
        });
    });
    
    // Add event listeners to "Take Mock" buttons in job cards
    const mockButtons = document.querySelectorAll('.take-mock-interview-btn');
    console.log(`Found ${mockButtons.length} 'Take Mock' buttons to attach listeners to`);
    
    mockButtons.forEach((button, index) => {
        // First remove any existing listeners by cloning and replacing the button
        const newButton = button.cloneNode(true);
        if (button.parentNode) {
            button.parentNode.replaceChild(newButton, button);
        }
        
        // Add fresh event listener
        newButton.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent default if it's an anchor
            console.log(`Take Mock button clicked (button ${index + 1})`);
            
            const jobId = this.getAttribute('data-job-id');
            if (jobId) {
                console.log(`Take Mock Interview clicked for job ID: ${jobId} (button ${index + 1})`);
                if (typeof takeMockInterview === 'function') {
                    takeMockInterview(jobId);
                } else {
                    console.error("takeMockInterview function not defined");
                    alert("This feature is currently unavailable. Please try again later.");
                }
            } else {
                console.error(`No job ID found on Take Mock button ${index + 1}`);
            }
        });
    });
    
    // Also bind the button in the job details modal
    const modalMockButton = document.getElementById('takeMockInterviewBtn');
    if (modalMockButton) {
        // Remove existing listeners
        const newModalButton = modalMockButton.cloneNode(true);
        if (modalMockButton.parentNode) {
            modalMockButton.parentNode.replaceChild(newModalButton, modalMockButton);
        }
        
        // Add fresh event listener
        newModalButton.addEventListener('click', function() {
            const jobId = this.getAttribute('data-job-id');
            if (jobId) {
                console.log("Take Mock Interview clicked from modal for job ID:", jobId);
                if (typeof takeMockInterview === 'function') {
                    takeMockInterview(jobId);
                } else {
                    console.error("takeMockInterview function not defined");
                    alert("This feature is currently unavailable. Please try again later.");
                }
            } else {
                console.error("No job ID found on modal Take Mock button");
            }
        });
    }
}

// Call this after jobs are loaded and displayed
// Add this to your job display function or where you currently 
// add event listeners to the job cards
function enhanceLoadPublicJobListings() {
    const original = loadPublicJobListings;
    
    // Replace the original function with our enhanced version
    window.loadPublicJobListings = function() {
        // Call the original function
        original.apply(this, arguments);
        
        // Add a small delay to ensure DOM is updated
        setTimeout(() => {
            console.log("Attaching job listing event listeners");
            attachJobListingEventListeners();
        }, 500);
    };
}

// Register our enhancement when the page loads
document.addEventListener('DOMContentLoaded', function() {
    if (typeof loadPublicJobListings === 'function') {
        enhanceLoadPublicJobListings();
    } else {
        console.warn("loadPublicJobListings function not found yet, will try again soon");
        // Try again after a small delay
        setTimeout(() => {
            if (typeof loadPublicJobListings === 'function') {
                enhanceLoadPublicJobListings();
            } else {
                console.error("loadPublicJobListings function not found, could not enhance");
            }
        }, 2000);
    }
});

// Improve the display job listings function to also attach our event listeners
function enhanceDisplayJobListings() {
    const original = displayJobListings;
    
    // Replace with enhanced version
    window.displayJobListings = function() {
        // Call original
        original.apply(this, arguments);
        
        // Add our event listeners
        setTimeout(() => {
            attachJobListingEventListeners();
        }, 100);
    };
}

// Add event listener for tab buttons with improved handling
function initImprovedTabButtons() {
    document.querySelectorAll('.tab-button').forEach(button => {
        // First remove any existing listeners by cloning and replacing
        const newButton = button.cloneNode(true);
        if (button.parentNode) {
            button.parentNode.replaceChild(newButton, button);
        }
        
        // Add fresh event listener with proper handling
        newButton.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent default link behavior
            const tabId = this.getAttribute('data-tab');
            if (tabId) {
                switchPublicTab(tabId);
                
                // Special handling for job listings tab to ensure it loads
                if (tabId === 'job-listings-tab') {
                    console.log("Tab button clicked for job listings");
                    
                    // Initialize if not done already
                    if (!window.publicJobListingsInitialized) {
                        console.log("Job listings not initialized yet, initializing now");
                        initPublicJobListings();
                        window.publicJobListingsInitialized = true;
                    } 
                    // If already initialized but we might need to reload
                    else if (!window.allJobs || window.allJobs.length === 0) {
                        console.log("Job listings initialized but no jobs loaded, reloading");
                        loadPublicJobListingsOptimized();
                    }
                }
            } else {
                console.warn("Tab button clicked but no data-tab attribute found");
            }
        });
    });
    
    console.log("Improved tab button handlers initialized");
}

// Also try to enhance displayJobListings
document.addEventListener('DOMContentLoaded', function() {
    if (typeof displayJobListings === 'function') {
        enhanceDisplayJobListings();
    } else {
        // Try again after a delay
        setTimeout(() => {
            if (typeof displayJobListings === 'function') {
                enhanceDisplayJobListings();
            }
        }, 2000);
    }
});

// Call these debugging functions once the page has loaded
// Add this code to your JavaScript to fix the display:
document.addEventListener('DOMContentLoaded', function() {
  const tabButton = document.querySelector('.tab-button[data-tab="job-listings-tab"]');
  if (tabButton) {
    tabButton.addEventListener('click', function() {
      console.log("Job listings tab clicked, running debug and fix");
      setTimeout(function() {
        debugJobListingDisplay();
        fixLoadPublicJobListings();
      }, 200); // Small delay to ensure tab is visible
    });
  }
});