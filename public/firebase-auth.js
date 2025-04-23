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


function loadUserProfile(user) {
  // Only load if we have a valid user and Firestore is available
  if (!user || typeof firebase === 'undefined' || !firebase.firestore) {
      console.warn("Cannot load profile: User null or Firebase/Firestore not available.");
      authState.userProfile = null; // Ensure profile is null
      return Promise.resolve(); // Return resolved promise so .finally() runs
  }

  const db = firebase.firestore();
  console.log(`Attempting to load profile for user: ${user.uid}`); // Add log

  // Return the promise chain
  return db.collection('users').doc(user.uid).get()
      .then(doc => {
          if (doc.exists) {
              authState.userProfile = doc.data();
              console.log('User profile loaded successfully:', authState.userProfile);
              
              // Ensure usage stats exist for existing profiles
              if (!authState.userProfile.usage) {
                  const usageUpdate = { 
                      usage: {
                          resumeAnalyses: { used: 0, limit: getPackageLimit('resumeAnalyses', authState.userProfile.plan || 'free') },
                          mockInterviews: { used: 0, limit: getPackageLimit('mockInterviews', authState.userProfile.plan || 'free') }
                      }
                  };
                  return db.collection('users').doc(user.uid).update(usageUpdate)
                      .then(() => {
                          authState.userProfile = {...authState.userProfile, ...usageUpdate};
                          console.log("Added usage stats to existing profile:", authState.userProfile);
                      })
                      .catch(updateError => {
                          console.error(`Error adding usage stats to profile:`, updateError);
                      });
              }
          } else {
              console.log('No user profile found in Firestore, attempting to create one');
              const newProfile = {
                  uid: user.uid,
                  email: user.email,
                  displayName: user.displayName || user.email.split('@')[0],
                  photoURL: user.photoURL || null, // Store null if no photoURL
                  createdAt: new Date().toISOString(),
                  plan: 'free', // Default plan
                  planPurchasedAt: new Date().toISOString(), // When free plan "started"
                  planExpiresAt: null, // No expiration for free plan
                  role: 'student', // Default role for all new users
                  collegeId: null, // New field
                  deptId: null, // New field
                  sectionId: null, // New field
                  usage: {
                      resumeAnalyses: { used: 0, limit: getPackageLimit('resumeAnalyses', 'free') },
                      mockInterviews: { used: 0, limit: getPackageLimit('mockInterviews', 'free') }
                  },
                  // lastActiveSessionId: null // Initialize explicitly if needed
              };
              // Attempt to save the new profile (this might fail if rules deny create)
              return db.collection('users').doc(user.uid).set(newProfile)
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
          console.error('Error loading user profile (check Firestore rules for \'read\'):', error);
          authState.userProfile = null; // Ensure profile is null on error
          // Don't re-throw here, let .finally() handle the next step
      });
}

function getPackageLimit(feature, packageName) {
  const limits = {
      free: {
          resumeAnalyses: 2,
          mockInterviews: 0
      },
      starter: {
          resumeAnalyses: 5,
          mockInterviews: 1
      },
      standard: {
          resumeAnalyses: 10,
          mockInterviews: 3
      },
      pro: {
          resumeAnalyses: 10,
          mockInterviews: 5
      }
  };
  
  // Default to free package limits if package not found
  if (!packageName || !limits[packageName]) {
      console.warn(`Unknown package: ${packageName}, defaulting to free`);
      packageName = 'free';
  }
  
  // Return the limit for the specified feature, or 0 if feature not found
  return limits[packageName][feature] || 0;
}

// --- New function to update user profile with plan change ---
function updateUserPlan(planName, expiresAt = null) {
  const user = firebase.auth().currentUser;
  if (!user || !firebase.firestore) {
      console.error("Cannot update plan: user not logged in or Firestore not available");
      return Promise.reject(new Error("Authentication or database error"));
  }
  
  const db = firebase.firestore();
  
  // Calculate new usage limits based on the plan
  const resumeLimit = getPackageLimit('resumeAnalyses', planName);
  const interviewLimit = getPackageLimit('mockInterviews', planName);
  
  // Keep track of current usage
  let currentResumeUsage = 0;
  let currentInterviewUsage = 0;
  
  if (authState.userProfile && authState.userProfile.usage) {
      currentResumeUsage = authState.userProfile.usage.resumeAnalyses.used || 0;
      currentInterviewUsage = authState.userProfile.usage.mockInterviews.used || 0;
  }
  
  // Update profile with new plan and limits
  const planUpdate = {
      plan: planName,
      planPurchasedAt: new Date().toISOString(),
      planExpiresAt: expiresAt, // null for free/no expiration
      'usage.resumeAnalyses.limit': resumeLimit,
      'usage.resumeAnalyses.used': currentResumeUsage,
      'usage.mockInterviews.limit': interviewLimit, 
      'usage.mockInterviews.used': currentInterviewUsage
  };
  
  return db.collection('users').doc(user.uid).update(planUpdate)
      .then(() => {
          // Update local state
          if (authState.userProfile) {
              authState.userProfile.plan = planName;
              authState.userProfile.planPurchasedAt = planUpdate.planPurchasedAt;
              authState.userProfile.planExpiresAt = expiresAt;
              
              // Ensure usage object exists
              if (!authState.userProfile.usage) {
                  authState.userProfile.usage = {};
              }
              
              // Update usage limits
              if (!authState.userProfile.usage.resumeAnalyses) {
                  authState.userProfile.usage.resumeAnalyses = { used: currentResumeUsage, limit: resumeLimit };
              } else {
                  authState.userProfile.usage.resumeAnalyses.limit = resumeLimit;
              }
              
              if (!authState.userProfile.usage.mockInterviews) {
                  authState.userProfile.usage.mockInterviews = { used: currentInterviewUsage, limit: interviewLimit };
              } else {
                  authState.userProfile.usage.mockInterviews.limit = interviewLimit;
              }
          }
          
          // Update UI elements
          updateUserProfileUI(user);
          return { success: true, plan: planName };
      })
      .catch(error => {
          console.error("Error updating user plan:", error);
          return Promise.reject(error);
      });
}

// --- New function to increment usage counter ---
function incrementUsageCounter(featureType) {
  const user = firebase.auth().currentUser;
  if (!user || !firebase.firestore) {
      console.error("Cannot increment usage: user not logged in or Firestore not available");
      return Promise.reject(new Error("Authentication or database error"));
  }
  
  // Validate feature type
  if (!['resumeAnalyses', 'mockInterviews'].includes(featureType)) {
      return Promise.reject(new Error(`Invalid feature type: ${featureType}`));
  }
  
  const db = firebase.firestore();
  
  // Increment usage counter with atomic operation
  const updateField = `usage.${featureType}.used`;
  
  return db.collection('users').doc(user.uid).update({
      [updateField]: firebase.firestore.FieldValue.increment(1)
  })
  .then(() => {
      // Update local state
      if (authState.userProfile && authState.userProfile.usage && authState.userProfile.usage[featureType]) {
          authState.userProfile.usage[featureType].used += 1;
          
          // Return updated usage info
          return {
              success: true,
              feature: featureType,
              used: authState.userProfile.usage[featureType].used,
              limit: authState.userProfile.usage[featureType].limit,
              canUseMore: authState.userProfile.usage[featureType].used < authState.userProfile.usage[featureType].limit
          };
      }
      
      return { success: true, feature: featureType };
  })
  .catch(error => {
      console.error(`Error incrementing ${featureType} usage:`, error);
      return Promise.reject(error);
  });
}

// --- New function to check if user can use a feature ---
function canUseFeature(featureType) {
  // If no profile loaded or no usage stats, default to false
  if (!authState.userProfile || !authState.userProfile.usage || !authState.userProfile.usage[featureType]) {
      return false;
  }
  
  const usage = authState.userProfile.usage[featureType];
  return usage.used < usage.limit;
}

function updateUserProfileUI(user) {
  // Update UI elements showing user info
  const userDisplayElements = document.querySelectorAll('.user-display-name');
  const userEmailElements = document.querySelectorAll('.user-email');
  const userAvatarElements = document.querySelectorAll('.user-avatar');
  const userRoleElements = document.querySelectorAll('.user-role');

  const displayName = user.displayName || authState.userProfile?.displayName || user.email.split('@')[0];
  const email = user.email;
  const photoURL = user.photoURL || 'https://i.stack.imgur.com/34AD2.jpg'; // Default avatar
  const role = authState.userProfile?.role || 'student';

  userDisplayElements.forEach(el => el.textContent = displayName);
  userEmailElements.forEach(el => el.textContent = email);
  userRoleElements.forEach(el => el.textContent = role);
  userAvatarElements.forEach(el => {
      if (el.tagName === 'IMG') {
          el.src = photoURL;
          el.alt = displayName;
      }
  });

  // Update additional profile fields
  const collegeIdElement = document.getElementById('userCollegeId');
  const deptIdElement = document.getElementById('userDeptId');
  const sectionIdElement = document.getElementById('userSectionId');
  
  if (collegeIdElement && authState.userProfile) {
      collegeIdElement.textContent = authState.userProfile.collegeId || 'Not specified';
  }
  
  if (deptIdElement && authState.userProfile) {
      deptIdElement.textContent = authState.userProfile.deptId || 'Not specified';
  }
  
  if (sectionIdElement && authState.userProfile) {
      sectionIdElement.textContent = authState.userProfile.sectionId || 'Not specified';
  }

  // Update plan info if available
  const planElements = document.querySelectorAll('.user-plan');
  const userPlanBadgeElements = document.querySelectorAll('.user-plan-badge');
  if (authState.userProfile && (planElements.length > 0 || userPlanBadgeElements.length > 0)) {
      const planName = authState.userProfile.plan || 'free';
      const formattedPlanName = planName.charAt(0).toUpperCase() + planName.slice(1);
      planElements.forEach(el => el.textContent = formattedPlanName);
      userPlanBadgeElements.forEach(el => el.textContent = formattedPlanName);
  }

  // Update usage counters
  if (authState.userProfile && authState.userProfile.usage) {
      // Resume analyses usage
      const resumeUsage = authState.userProfile.usage.resumeAnalyses || { used: 0, limit: 0 };
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
      
      // Mock interviews usage
      const interviewUsage = authState.userProfile.usage.mockInterviews || { used: 0, limit: 0 };
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
  }

  // Show/Hide Password Buttons based on providers
  const addPasswordBtn = document.getElementById('addPasswordBtn');
  const changePasswordBtn = document.getElementById('changePasswordBtn');
  if (user && addPasswordBtn && changePasswordBtn) {
      // Check if 'password' is listed in the providerData array
      const hasPasswordProvider = user.providerData.some(provider => provider.providerId === 'password');

      // Show "Add Password" if NO password provider exists
      addPasswordBtn.style.display = hasPasswordProvider ? 'none' : 'block';
      // Show "Change Password" if a password provider DOES exist
      changePasswordBtn.style.display = hasPasswordProvider ? 'block' : 'none';
  } else {
      // Ensure buttons are hidden if user/elements aren't ready
      if(addPasswordBtn) addPasswordBtn.style.display = 'none';
      if(changePasswordBtn) changePasswordBtn.style.display = 'none';
  }
}

function clearUserProfileUI() {
  // Clear user-related UI elements
  const userDisplayElements = document.querySelectorAll('.user-display-name');
  const userEmailElements = document.querySelectorAll('.user-email');
  const userAvatarElements = document.querySelectorAll('.user-avatar');
  const planElements = document.querySelectorAll('.user-plan');
  const userPlanBadgeElements = document.querySelectorAll('.user-plan-badge');
  const userRoleElements = document.querySelectorAll('.user-role');

  userDisplayElements.forEach(el => el.textContent = '...'); // Use placeholder
  userEmailElements.forEach(el => el.textContent = '...'); // Use placeholder
  userRoleElements.forEach(el => el.textContent = '...'); // Use placeholder
  userAvatarElements.forEach(el => {
      if (el.tagName === 'IMG') {
          el.src = 'https://i.stack.imgur.com/34AD2.jpg'; // Default placeholder
          el.alt = 'User';
      }
  });
  planElements.forEach(el => el.textContent = '');
  userPlanBadgeElements.forEach(el => el.textContent = ''); // Clear sidebar badge

  // Clear additional profile fields
  const collegeIdElement = document.getElementById('userCollegeId');
  const deptIdElement = document.getElementById('userDeptId');
  const sectionIdElement = document.getElementById('userSectionId');
  
  if (collegeIdElement) collegeIdElement.textContent = 'Not specified';
  if (deptIdElement) deptIdElement.textContent = 'Not specified';
  if (sectionIdElement) sectionIdElement.textContent = 'Not specified';

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
          // Add additional user data to Firestore if needed
          if (firebase.firestore) {
            // This might be redundant as loadUserProfile will create the doc,
            // but we can ensure all fields are set immediately
            const db = firebase.firestore();
            return db.collection('users').doc(userCredential.user.uid).set({
              uid: userCredential.user.uid,
              email: email,
              displayName: displayName,
              role: 'student',
              collegeId: null,
              deptId: null,
              sectionId: null,
              createdAt: new Date().toISOString(),
              plan: 'free',
              planPurchasedAt: new Date().toISOString(),
              usage: {
                resumeAnalyses: { used: 0, limit: getPackageLimit('resumeAnalyses', 'free') },
                mockInterviews: { used: 0, limit: getPackageLimit('mockInterviews', 'free') }
              }
            }, { merge: true }).then(() => {
              hideAuthModal();
              return userCredential.user;
            });
          } else {
            hideAuthModal();
            return userCredential.user;
          }
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
  showSignUpModal: () => showAuthModal('signup'),
  // Add new functions to the exported object
  canUseFeature,
  incrementUsageCounter,
  updateUserPlan,
  getPackageLimit
};