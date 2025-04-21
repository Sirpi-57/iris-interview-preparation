// IRIS - Firebase Authentication Module

// Firebase configuration object
const firebaseConfig = {
  apiKey: "AIzaSyBw3b7RrcIzL7Otog58Bu52eUH5e3zab8I",
  authDomain: "iris-ai-prod.firebaseapp.com",
  projectId: "iris-ai-prod",
  storageBucket: "iris-ai-prod.firebasestorage.app",
  messagingSenderId: "223585438",
  appId: "1:223585438:web:7ceeb88553e550e1a0c78f",
  measurementId: "G-JF7KVLNXRL"
};

// Global auth state
const authState = {
  user: null,
  userProfile: null,
  initialized: false,
  subscription: null, // For payment info later
};

// Initialize Firebase
document.addEventListener('DOMContentLoaded', () => {
  initializeFirebase();
});

function initializeFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK not loaded!');
    showErrorMessage('Firebase initialization failed. Please check your internet connection and try again.');
    return;
  }

  try {
    // Initialize Firebase if not already initialized
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    // Initialize Analytics if available
    if (firebase.analytics) {
      firebase.analytics();
    }

    // Set up authentication state observer
    firebase.auth().onAuthStateChanged(handleAuthStateChanged);
    
    console.log('Firebase initialized successfully');
    authState.initialized = true;
    
    // Attach event listeners to auth-related buttons
    attachAuthEventListeners();
    
  } catch (error) {
    console.error('Firebase initialization error:', error);
    showErrorMessage('Firebase initialization failed: ' + error.message);
  }
}

function handleAuthStateChanged(user) {
    console.log('Auth state changed:', user ? `User ${user.email} signed in` : 'User signed out');
    authState.user = user;

    if (user) {
        // User is signed in - Load profile FIRST, then initialize app state
        loadUserProfile(user) // loadUserProfile already handles success/failure internally
            .finally(() => {
                // This block runs *after* loadUserProfile finishes or fails
                console.log("Profile load attempt finished. Current profile state:", authState.userProfile);
                showAppView(); // Show the app view
                updateUserProfileUI(user); // Update UI with basic auth info
                // Initialize app logic *after* profile attempt and showing view
                if (typeof initializeIRISApp === 'function') {
                    initializeIRISApp(); // Now safe to check authState.userProfile
                }
            });
    } else {
        // User is signed out
        authState.userProfile = null;
        // Remove localStorage item if it was ever used (belt-and-suspenders, though we stopped setting it)
        // localStorage.removeItem('irisSessionId');
        // Reset form fields
        const resumeInput = document.getElementById('resumeFile');
        const jobDescriptionInput = document.getElementById('jobDescription');
        if (resumeInput) resumeInput.value = null;
        if (jobDescriptionInput) jobDescriptionInput.value = '';
        const progressContainer = document.getElementById('uploadProgress');
        if (progressContainer) { /* ... reset progress bar ... */ }
        // Reset other app state if needed
        // resetAppState();
        showPublicView();
        clearUserProfileUI();
    }
}


// Replace this entire function in firebase-auth.js
function loadUserProfile(user) {
  // Only load if we have a valid user and Firestore is available
  if (!user || typeof firebase === 'undefined' || !firebase.firestore) {
      console.warn("Cannot load profile: User null or Firebase/Firestore not available.");
      authState.userProfile = null; // Ensure profile is null
      return Promise.resolve(); // Return resolved promise so .finally() runs
  }

  const db = firebase.firestore();
  const userRef = db.collection('users').doc(user.uid);
  console.log(`Attempting to load profile for user: ${user.uid}`);

  // Return the promise chain
  return userRef.get()
      .then(doc => {
          if (doc.exists) {
              // Document exists, load data and check for plan fields
              const profileData = doc.data();
              // Set defaults if fields are missing from existing document
              profileData.plan = profileData.plan || 'free';
              profileData.resumeCreditsRemaining = profileData.resumeCreditsRemaining !== undefined ? profileData.resumeCreditsRemaining : 2;
              profileData.mockInterviewsRemaining = profileData.mockInterviewsRemaining !== undefined ? profileData.mockInterviewsRemaining : 0;

              authState.userProfile = profileData;
              console.log('User profile loaded successfully:', authState.userProfile);
              // If defaults were added, update the document (optional, but good practice)
              if (profileData.plan === 'free' && (profileData.resumeCreditsRemaining === 2 || profileData.mockInterviewsRemaining === 0) && (!doc.data().plan || doc.data().resumeCreditsRemaining === undefined || doc.data().mockInterviewsRemaining === undefined)) {
                console.log("Updating existing profile with default plan/credit fields.");
                return userRef.update({
                    plan: profileData.plan,
                    resumeCreditsRemaining: profileData.resumeCreditsRemaining,
                    mockInterviewsRemaining: profileData.mockInterviewsRemaining
                }).catch(updateError => {
                    console.error("Error updating existing profile with defaults:", updateError);
                    // Continue even if update fails, profile is loaded in authState
                });
              }

          } else {
              // Document doesn't exist, create a new one with defaults
              console.log('No user profile found in Firestore, creating one with default free plan');
              const newProfile = {
                  uid: user.uid,
                  email: user.email,
                  displayName: user.displayName || user.email.split('@')[0],
                  photoURL: user.photoURL || null,
                  createdAt: new Date().toISOString(),
                  plan: 'free', // Default plan
                  resumeCreditsRemaining: 2, // Default free limit
                  mockInterviewsRemaining: 0 // Default free limit
              };
              // Attempt to save the new profile
              return userRef.set(newProfile) // Use set() for creation
                  .then(() => {
                      authState.userProfile = newProfile;
                      console.log("New user profile created successfully:", authState.userProfile);
                  })
                  .catch(createError => {
                      console.error(`Error creating user profile (check Firestore rules for 'create'):`, createError);
                      authState.userProfile = null; // Ensure profile is null if creation fails
                  });
          }
      })
      .catch(error => {
          console.error('Error loading/creating user profile (check Firestore rules for \'read\'/\'write\'):', error);
          authState.userProfile = null; // Ensure profile is null on error
      });
}

// Replace this entire function in firebase-auth.js
function updateUserProfileUI(user) {
  // Update UI elements showing user info
  const userDisplayElements = document.querySelectorAll('.user-display-name');
  const userEmailElements = document.querySelectorAll('.user-email');
  const userAvatarElements = document.querySelectorAll('.user-avatar');

  // Use profile data if available, otherwise fallback to auth user data
  const displayName = authState.userProfile?.displayName || user.displayName || user.email?.split('@')[0] || 'User';
  const email = user.email || authState.userProfile?.email || 'No Email';
  const photoURL = authState.userProfile?.photoURL || user.photoURL || 'https://i.stack.imgur.com/34AD2.jpg'; // Default avatar

  userDisplayElements.forEach(el => el.textContent = displayName);
  userEmailElements.forEach(el => el.textContent = email);
  userAvatarElements.forEach(el => {
      if (el.tagName === 'IMG') {
          el.src = photoURL;
          el.alt = displayName;
      }
  });

  // --- MODIFIED PLAN DISPLAY ---
  const planBadgeElements = document.querySelectorAll('.user-plan-badge'); // Target only the badges
  if (authState.userProfile) { // Check if profile is loaded
      const planName = authState.userProfile.plan || 'free'; // Default to 'free' if plan field missing
      const formattedPlanName = planName.charAt(0).toUpperCase() + planName.slice(1);
      planBadgeElements.forEach(el => {
          el.textContent = formattedPlanName;
          // Optional: Add classes based on plan for different colors?
          el.className = 'user-plan-badge badge rounded-pill p-2'; // Reset classes
          if (planName === 'free') {
              el.classList.add('bg-secondary'); // Example style for free
          } else if (planName === 'starter') {
              el.classList.add('bg-info');
          } else if (planName === 'standard') {
              el.classList.add('bg-primary');
          } else if (planName === 'pro') {
              el.classList.add('bg-success');
          } else {
              el.classList.add('bg-secondary'); // Default fallback
          }
      });
      console.log(`UI Updated: Displaying plan - ${formattedPlanName}`);
  } else {
      // If profile hasn't loaded yet, maybe show loading or default
      planBadgeElements.forEach(el => el.textContent = '...');
      console.log("UI Update: User profile not yet loaded for plan display.");
  }
  // --- END MODIFIED PLAN DISPLAY ---


  // Show/Hide Password Buttons based on providers
  const addPasswordBtn = document.getElementById('addPasswordBtn');
  const changePasswordBtn = document.getElementById('changePasswordBtn');
  if (user && addPasswordBtn && changePasswordBtn) {
      const hasPasswordProvider = user.providerData.some(provider => provider.providerId === 'password');
      addPasswordBtn.style.display = hasPasswordProvider ? 'none' : 'block';
      changePasswordBtn.style.display = hasPasswordProvider ? 'block' : 'none';
      // console.log("User providers:", user.providerData.map(p => p.providerId)); // Debugging
      // console.log("Password provider exists:", hasPasswordProvider); // Debugging
  } else {
      if(addPasswordBtn) addPasswordBtn.style.display = 'none';
      if(changePasswordBtn) changePasswordBtn.style.display = 'none';
  }
}

// Replace this entire function in firebase-auth.js
function clearUserProfileUI() {
  // Clear user-related UI elements
  const userDisplayElements = document.querySelectorAll('.user-display-name');
  const userEmailElements = document.querySelectorAll('.user-email');
  const userAvatarElements = document.querySelectorAll('.user-avatar');
  const planElements = document.querySelectorAll('.user-plan');
  const userPlanBadgeElements = document.querySelectorAll('.user-plan-badge');

  userDisplayElements.forEach(el => el.textContent = '...'); // Use placeholder
  userEmailElements.forEach(el => el.textContent = '...'); // Use placeholder
  userAvatarElements.forEach(el => {
      if (el.tagName === 'IMG') {
          el.src = 'https://i.stack.imgur.com/34AD2.jpg'; // Default placeholder
          el.alt = 'User';
      }
  });
  planElements.forEach(el => el.textContent = '');
  userPlanBadgeElements.forEach(el => el.textContent = ''); // Clear sidebar badge

  // Reset Password Buttons visibility
  const addPasswordBtn = document.getElementById('addPasswordBtn');
  const changePasswordBtn = document.getElementById('changePasswordBtn');
  if(addPasswordBtn) addPasswordBtn.style.display = 'none'; // Hide when logged out
  if(changePasswordBtn) changePasswordBtn.style.display = 'none'; // Hide when logged out
}

// View switching logic
function showPublicView() {
  document.getElementById('public-view').style.display = 'block';
  document.getElementById('app-view').style.display = 'none';
  
  // Show active tab in public view
  const lastPublicTab = localStorage.getItem('lastPublicTab') || 'welcome-tab';
  switchPublicTab(lastPublicTab);
}

function showAppView() {
  console.log("Attempting to show App View...");
  document.getElementById('public-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'flex';
  
  // Initialize IRIS app if needed
  if (typeof initializeIRISApp === 'function') {
    initializeIRISApp();
  }
}

function switchPublicTab(tabId) {
  // Hide all tabs
  document.querySelectorAll('.public-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected tab
  const selectedTab = document.getElementById(tabId);
  if (selectedTab) {
    selectedTab.classList.add('active');
    localStorage.setItem('lastPublicTab', tabId);
  }
  
  // Update tab buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    }
  });
}

// Authentication functions
function signInWithEmailPassword(email, password) {
  if (!firebase.auth) {
    showErrorMessage('Authentication service not available');
    return Promise.reject(new Error('Authentication service not available'));
  }
  
  return firebase.auth().signInWithEmailAndPassword(email, password)
    .then(userCredential => {
      console.log('User signed in successfully');
      hideAuthModal();
      return userCredential.user;
    })
    .catch(error => {
      console.error('Sign in error:', error);
      showErrorMessage(`Sign in failed: ${error.message}`);
      throw error;
    });
}

function signUpWithEmailPassword(email, password, displayName) {
  if (!firebase.auth) {
    showErrorMessage('Authentication service not available');
    return Promise.reject(new Error('Authentication service not available'));
  }
  
  return firebase.auth().createUserWithEmailAndPassword(email, password)
    .then(userCredential => {
      console.log('User signed up successfully');
      
      // Set display name if provided
      if (displayName) {
        return userCredential.user.updateProfile({
          displayName: displayName
        }).then(() => {
          hideAuthModal();
          return userCredential.user;
        });
      } else {
        hideAuthModal();
        return userCredential.user;
      }
    })
    .catch(error => {
      console.error('Sign up error:', error);
      showErrorMessage(`Sign up failed: ${error.message}`);
      throw error;
    });
}

function signInWithGoogle() {
  if (!firebase.auth) {
    showErrorMessage('Authentication service not available');
    return Promise.reject(new Error('Authentication service not available'));
  }
  
  const provider = new firebase.auth.GoogleAuthProvider();
  return firebase.auth().signInWithPopup(provider)
    .then(result => {
      console.log('Google sign in successful');
      hideAuthModal();
      return result.user;
    })
    .catch(error => {
      console.error('Google sign in error:', error);
      showErrorMessage(`Google sign in failed: ${error.message}`);
      throw error;
    });
}

function signOut() {
  if (!firebase.auth) { /* ... */ }
  return firebase.auth().signOut()
    .then(() => {
      console.log('User signed out successfully');
      // localStorage.removeItem('irisSessionId'); // <<< REMOVE THIS LINE
      const resumeInput = document.getElementById('resumeFile'); // Keep form reset
      const jobDescriptionInput = document.getElementById('jobDescription');
      if (resumeInput) resumeInput.value = null;
      if (jobDescriptionInput) jobDescriptionInput.value = '';
      const progressContainer = document.getElementById('uploadProgress'); // Keep progress reset
       if (progressContainer) { /* ... reset progress bar ... */ }
    })
    .catch(error => { /* ... */ });
}

// UI Helper functions
function showAuthModal(mode = 'signin') {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  
  // Show appropriate form
  document.getElementById('signin-form').style.display = mode === 'signin' ? 'block' : 'none';
  document.getElementById('signup-form').style.display = mode === 'signup' ? 'block' : 'none';
  
  // Update modal title
  document.getElementById('auth-modal-title').textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
  
  // Show modal
  const modalInstance = new bootstrap.Modal(modal);
  modalInstance.show();
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  
  const modalInstance = bootstrap.Modal.getInstance(modal);
  if (modalInstance) {
    modalInstance.hide();
  }
}

function showErrorMessage(message, duration = 5000) {
  // Create toast or use existing error container
  const errorContainer = document.getElementById('error-messages');
  if (errorContainer) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert-danger alert-dismissible fade show';
    errorDiv.innerHTML = `
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    errorContainer.appendChild(errorDiv);
    
    // Auto-dismiss after duration
    setTimeout(() => {
      errorDiv.classList.remove('show');
      setTimeout(() => errorDiv.remove(), 500);
    }, duration);
  } else {
    // Fallback to alert if container doesn't exist
    console.error(message);
    alert(message);
  }
}

// Event listeners
function attachAuthEventListeners() {
  // Sign in form submission
  document.getElementById('signin-form')?.addEventListener('submit', function(e) {
    e.preventDefault();
    const email = document.getElementById('signin-email').value;
    const password = document.getElementById('signin-password').value;
    signInWithEmailPassword(email, password);
  });
  
  // Sign up form submission
  document.getElementById('signup-form')?.addEventListener('submit', function(e) {
    e.preventDefault();
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const name = document.getElementById('signup-name').value;
    signUpWithEmailPassword(email, password, name);
  });
  
  // Google sign in button
  document.getElementById('google-signin-button')?.addEventListener('click', function() {
    signInWithGoogle();
  });
  
  // Sign out button(s)
  document.querySelectorAll('.signout-button').forEach(button => {
    button.addEventListener('click', function() {
      signOut();
    });
  });
  
  // Modal trigger buttons
  document.querySelectorAll('[data-auth="signin"]').forEach(button => {
    button.addEventListener('click', function() {
      showAuthModal('signin');
    });
  });
  
  document.querySelectorAll('[data-auth="signup"]').forEach(button => {
    button.addEventListener('click', function() {
      showAuthModal('signup');
    });
  });
  
  // Public view tab buttons
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', function() {
      switchPublicTab(this.getAttribute('data-tab'));
    });
  });
}

// Export functions for global use
window.irisAuth = {
  signIn: signInWithEmailPassword,
  signUp: signUpWithEmailPassword,
  signInWithGoogle,
  signOut,
  getCurrentUser: () => authState.user,
  getUserProfile: () => authState.userProfile,
  showSignInModal: () => showAuthModal('signin'),
  showSignUpModal: () => showAuthModal('signup')
};