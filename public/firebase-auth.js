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
      // User is signed in
      
      // Hold these variables but don't process them yet
      const pendingPlan = localStorage.getItem('pendingPlanSelection');
      const pendingAddonStr = localStorage.getItem('pendingAddonPurchase');
      
      return loadUserProfile(user)
        .then(() => {
          // Check email verification FIRST and block payment if not verified
          return checkEmailVerification(user)
            .then(isVerified => {
              // Store verification state globally for reference
              authState.isEmailVerified = isVerified;
              
              // Show warning if email is not verified
              if (!isVerified) {
                console.log("Email not verified for user:", user.email);
                
                // Only show verification message if they're not in the middle of payment flow
                showMessage('Please verify your email address before proceeding', 'info');
                
                // Show verification modal for all unverified accounts
                showEmailVerificationModal(user.email);
                
                // Store pending payment data for use after verification
                if (pendingPlan) {
                  localStorage.setItem('postVerificationPlan', pendingPlan);
                  localStorage.removeItem('pendingPlanSelection');
                  showMessage('You need to verify your email before upgrading your plan', 'warning');
                }
                
                if (pendingAddonStr) {
                  localStorage.setItem('postVerificationAddon', pendingAddonStr);
                  localStorage.removeItem('pendingAddonPurchase');
                  showMessage('You need to verify your email before purchasing add-ons', 'warning');
                }
              } else {
                console.log("Email verified for user:", user.email);
                // Now that email is verified, check for post-verification payments
                const postVerificationPlan = localStorage.getItem('postVerificationPlan');
                const postVerificationAddon = localStorage.getItem('postVerificationAddon');
                
                if (postVerificationPlan) {
                  localStorage.removeItem('postVerificationPlan');
                  
                  // Give a moment for everything to fully initialize
                  setTimeout(() => {
                      console.log(`Processing post-verification plan selection: ${postVerificationPlan}`);
                      // Trigger plan selection with payment
                      if (typeof selectPlanFixed === 'function') {
                          selectPlanFixed(postVerificationPlan);
                      } else {
                          console.warn("selectPlanFixed function not found. Cannot process pending plan.");
                          showMessage("Unable to continue with plan selection. Please try again from your profile.", "warning");
                      }
                  }, 1500);
                } else if (postVerificationAddon) {
                  // Process addon purchase if there's no pending plan
                  try {
                      const pendingAddon = JSON.parse(postVerificationAddon);
                      localStorage.removeItem('postVerificationAddon');
                      
                      setTimeout(() => {
                          console.log(`Processing post-verification addon purchase:`, pendingAddon);
                          if (typeof purchaseAddonItem === 'function') {
                              purchaseAddonItem(pendingAddon.featureType, pendingAddon.quantity);
                          } else {
                              console.warn("purchaseAddonItem function not found. Cannot process pending addon.");
                              showMessage("Unable to continue with add-on purchase. Please try again from your profile.", "warning");
                          }
                      }, 1500);
                  } catch (e) {
                      console.error("Error parsing pending addon data:", e);
                      localStorage.removeItem('postVerificationAddon');
                  }
                }
              }
              return isVerified; // Return verification status
            });
        })
        .finally(() => {
          // This block runs *after* loadUserProfile and email verification check
          console.log("Profile load attempt finished. Current profile state:", authState.userProfile);
          showAppView(); // Show the app view
          updateUserProfileUI(user); // Update UI with basic auth info
          
          // Initialize app logic *after* profile attempt and showing view
          if (typeof initializeIRISApp === 'function') {
              initializeIRISApp(); // Now safe to check authState.userProfile
          }
        });
  } else {
      // User is signed out logic (no changes needed)
      authState.userProfile = null;
      authState.isEmailVerified = false;
      // Reset form fields
      const resumeInput = document.getElementById('resumeFile');
      const jobDescriptionInput = document.getElementById('jobDescription');
      if (resumeInput) resumeInput.value = null;
      if (jobDescriptionInput) jobDescriptionInput.value = '';
      const progressContainer = document.getElementById('uploadProgress');
      if (progressContainer) { 
          progressContainer.style.display = 'none';
      }
      
      // Clear any pending purchase actions if user signs out
      localStorage.removeItem('pendingPlanSelection');
      localStorage.removeItem('pendingAddonPurchase');
      localStorage.removeItem('postVerificationPlan');
      localStorage.removeItem('postVerificationAddon');
      
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
                        mockInterviews: { used: 0, limit: getPackageLimit('mockInterviews', authState.userProfile.plan || 'free') },
                        pdfDownloads: { used: 0, limit: getPackageLimit('pdfDownloads', authState.userProfile.plan || 'free') },
                        aiEnhance: { used: 0, limit: getPackageLimit('aiEnhance', authState.userProfile.plan || 'free') }
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
                      mockInterviews: { used: 0, limit: getPackageLimit('mockInterviews', 'free') },
                      pdfDownloads: { used: 0, limit: getPackageLimit('pdfDownloads', 'free') },
                      aiEnhance: { used: 0, limit: getPackageLimit('aiEnhance', 'free') }
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
      'free': {
          'resumeAnalyses': 1,
          'mockInterviews': 0,
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
  };
  
  // Make packageName lowercase for case-insensitivity 
  if (packageName) {
      packageName = packageName.toLowerCase();
  }
  
  // Default to free package if not found
  if (!packageName || !limits[packageName]) {
      console.warn(`Unknown package: ${packageName}, defaulting to free`);
      packageName = 'free';
  }
  
  // Check if feature exists in the package
  if (!limits[packageName][feature]) {
      console.warn(`Unknown package: ${feature}, defaulting to free`);
      return 0;
  }
  
  // Return the limit for the feature
  return limits[packageName][feature];
}

// // --- New function to update user profile with plan change ---
// function updateUserPlan(planName, expiresAt = null) {
//   const user = firebase.auth().currentUser;
//   if (!user || !firebase.firestore) {
//       console.error("Cannot update plan: user not logged in or Firestore not available");
//       return Promise.reject(new Error("Authentication or database error"));
//   }
  
//   const db = firebase.firestore();
  
//   // Calculate new usage limits based on the plan
//   const resumeLimit = getPackageLimit('resumeAnalyses', planName);
//   const interviewLimit = getPackageLimit('mockInterviews', planName);
  
//   // Keep track of current usage
//   let currentResumeUsage = 0;
//   let currentInterviewUsage = 0;
  
//   if (authState.userProfile && authState.userProfile.usage) {
//       currentResumeUsage = authState.userProfile.usage.resumeAnalyses.used || 0;
//       currentInterviewUsage = authState.userProfile.usage.mockInterviews.used || 0;
//   }
  
//   // Update profile with new plan and limits
//   const planUpdate = {
//     plan: planName,
//     planPurchasedAt: new Date().toISOString(),
//     planExpiresAt: expiresAt, // null for free/no expiration
//     'usage.resumeAnalyses.limit': resumeLimit,
//     'usage.resumeAnalyses.used': currentResumeUsage,
//     'usage.mockInterviews.limit': interviewLimit, 
//     'usage.mockInterviews.used': currentInterviewUsage,
//     'usage.pdfDownloads.limit': getPackageLimit('pdfDownloads', planName),
//     'usage.pdfDownloads.used': authState.userProfile?.usage?.pdfDownloads?.used || 0,
//     'usage.aiEnhance.limit': getPackageLimit('aiEnhance', planName),
//     'usage.aiEnhance.used': authState.userProfile?.usage?.aiEnhance?.used || 0
//   };
  
//   return db.collection('users').doc(user.uid).update(planUpdate)
//       .then(() => {
//           // Update local state
//           if (authState.userProfile) {
//               authState.userProfile.plan = planName;
//               authState.userProfile.planPurchasedAt = planUpdate.planPurchasedAt;
//               authState.userProfile.planExpiresAt = expiresAt;
              
//               // Ensure usage object exists
//               if (!authState.userProfile.usage) {
//                   authState.userProfile.usage = {};
//               }
              
//               // Update usage limits
//               if (!authState.userProfile.usage.resumeAnalyses) {
//                   authState.userProfile.usage.resumeAnalyses = { used: currentResumeUsage, limit: resumeLimit };
//               } else {
//                   authState.userProfile.usage.resumeAnalyses.limit = resumeLimit;
//               }
              
//               if (!authState.userProfile.usage.mockInterviews) {
//                   authState.userProfile.usage.mockInterviews = { used: currentInterviewUsage, limit: interviewLimit };
//               } else {
//                   authState.userProfile.usage.mockInterviews.limit = interviewLimit;
//               }

//               if (!authState.userProfile.usage.pdfDownloads) {
//                 authState.userProfile.usage.pdfDownloads = { 
//                     used: authState.userProfile?.usage?.pdfDownloads?.used || 0, 
//                     limit: getPackageLimit('pdfDownloads', planName) 
//                 };
//               } else {
//                   authState.userProfile.usage.pdfDownloads.limit = getPackageLimit('pdfDownloads', planName);
//               }
              
//               if (!authState.userProfile.usage.aiEnhance) {
//                   authState.userProfile.usage.aiEnhance = { 
//                       used: authState.userProfile?.usage?.aiEnhance?.used || 0, 
//                       limit: getPackageLimit('aiEnhance', planName) 
//                   };
//               } else {
//                   authState.userProfile.usage.aiEnhance.limit = getPackageLimit('aiEnhance', planName);
//               }
//           }
          
//           // Update UI elements
//           updateUserProfileUI(user);
//           return { success: true, plan: planName };
//       })
//       .catch(error => {
//           console.error("Error updating user plan:", error);
//           return Promise.reject(error);
//       });
// }

// --- New function to increment usage counter ---
function incrementUsageCounter(featureType) {
  const user = firebase.auth().currentUser;
  if (!user || !firebase.firestore) {
      console.error("Cannot increment usage: user not logged in or Firestore not available");
      return Promise.reject(new Error("Authentication or database error"));
  }
  
  // Validate feature type
  if (!['resumeAnalyses', 'mockInterviews', 'pdfDownloads', 'aiEnhance'].includes(featureType)) {
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
    console.log(`Switching to public tab: ${tabId}`);
    
    // Hide all tabs with a smooth transition
    document.querySelectorAll('.public-tab').forEach(tab => {
        tab.style.opacity = '0';
        tab.style.display = 'none';
        tab.classList.remove('active');
    });
    
    // Show selected tab
    const selectedTab = document.getElementById(tabId);
    if (selectedTab) {
        // First make it visible but transparent for the transition
        selectedTab.style.display = 'block';
        
        // Force a reflow to ensure the transition works
        void selectedTab.offsetWidth;
        
        // Now fade it in
        setTimeout(() => {
            selectedTab.style.opacity = '1';
            selectedTab.classList.add('active');
        }, 50);
        
        localStorage.setItem('lastPublicTab', tabId);
        
        // Special handling for job listings tab
        if (tabId === 'job-listings-tab' && !window.publicJobListingsInitialized) {
            console.log("Tab switched to job listings, initializing listings");
            initPublicJobListings();
            window.publicJobListingsInitialized = true;
        }
    } else {
        console.error(`Tab "${tabId}" not found`);
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
      const updatePromise = displayName ? 
        userCredential.user.updateProfile({ displayName: displayName }) : 
        Promise.resolve();
        
      return updatePromise
        .then(() => {
          // Send verification email
          return sendEmailVerification(userCredential.user);
        })
        .then(() => {
          // Add additional user data to Firestore
          if (firebase.firestore) {
            const db = firebase.firestore();
            return db.collection('users').doc(userCredential.user.uid).set({
              uid: userCredential.user.uid,
              email: email,
              displayName: displayName || email.split('@')[0],
              emailVerified: false, // Initially set to false
              role: 'student',
              collegeId: null,
              deptId: null,
              sectionId: null,
              createdAt: new Date().toISOString(),
              plan: 'free',
              planPurchasedAt: new Date().toISOString(),
              usage: {
                resumeAnalyses: { used: 0, limit: getPackageLimit('resumeAnalyses', 'free') },
                mockInterviews: { used: 0, limit: getPackageLimit('mockInterviews', 'free') },
                pdfDownloads: { used: 0, limit: getPackageLimit('pdfDownloads', 'free') },
                aiEnhance: { used: 0, limit: getPackageLimit('aiEnhance', 'free') }
              }
            }, { merge: true }).then(() => {
              hideAuthModal();
              
              // Show email verification notice
              showEmailVerificationModal(email);
              
              return userCredential.user;
            });
          } else {
            hideAuthModal();
            showEmailVerificationModal(email);
            return userCredential.user;
          }
        });
    })
    .catch(error => {
      console.error('Sign up error:', error);
      showErrorMessage(`Sign up failed: ${error.message}`);
      throw error;
    });
}

// Function to check email verification status
function checkEmailVerification(user) {
  if (!user) return Promise.resolve(false);
  
  // Force refresh token to get latest emailVerified status
  return user.reload()
    .then(() => {
      const isVerified = user.emailVerified;
      
      // Update user profile in Firestore if verified
      if (isVerified && firebase.firestore) {
        return firebase.firestore().collection('users').doc(user.uid).update({
          emailVerified: true
        })
        .then(() => {
          // Update local state
          if (authState.userProfile) {
            authState.userProfile.emailVerified = true;
          }
          return true;
        })
        .catch(error => {
          console.error('Error updating email verification status:', error);
          return isVerified; // Still return true if verification status is true
        });
      }
      
      return isVerified;
    })
    .catch(error => {
      console.error('Error checking email verification:', error);
      return false;
    });
}

// Updated showEmailVerificationModal function
function showEmailVerificationModal(email) {
  // Create the modal element if it doesn't exist
  let modalDiv = document.getElementById('email-verification-modal');
  if (!modalDiv) {
    modalDiv = document.createElement('div');
    modalDiv.className = 'modal fade';
    modalDiv.id = 'email-verification-modal';
    modalDiv.tabIndex = '-1';
    modalDiv.setAttribute('aria-hidden', 'true');
    
    modalDiv.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Verify Your Email</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="text-center mb-4">
              <i class="fas fa-envelope fa-3x text-primary"></i>
            </div>
            <p>We've sent a verification email to: <strong id="verification-email-address">${email}</strong></p>
            <p>Please check your inbox and click the verification link to activate your account.</p>
            <div class="alert alert-info">
              <i class="fas fa-info-circle me-2"></i>
              <strong>Important:</strong> You need to verify your email before you can use all features of IRIS.
            </div>
            <p class="small text-muted">Didn't receive the email? Check your spam folder, or click the resend button below.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-info" id="check-verification-btn">Check Verification Status</button>
            <button type="button" class="btn btn-primary" id="resend-verification-btn">Resend Verification</button>
          </div>
        </div>
      </div>
    `;
    
    // Append the modal to the document body
    document.body.appendChild(modalDiv);
  } else {
    // Update the email address if the modal already exists
    const emailElement = document.getElementById('verification-email-address');
    if (emailElement) {
      emailElement.textContent = email;
    }
  }
  
  // Initialize Bootstrap modal
  const verificationModal = bootstrap.Modal.getInstance(modalDiv) || 
                           new bootstrap.Modal(modalDiv);
  verificationModal.show();
  
  // Start polling for verification status
  const user = firebase.auth().currentUser;
  let pollingInterval = null;
  
  if (user) {
    pollingInterval = startVerificationPolling(user, verificationModal);
  }
  
  // Add event listener for resend button
  const resendBtn = document.getElementById('resend-verification-btn');
  if (resendBtn) {
    // Remove existing listeners by cloning
    const newResendBtn = resendBtn.cloneNode(true);
    if (resendBtn.parentNode) {
      resendBtn.parentNode.replaceChild(newResendBtn, resendBtn);
    }
    
    newResendBtn.addEventListener('click', function() {
      const user = firebase.auth().currentUser;
      if (user) {
        // Show loading state
        const btn = this;
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...';
        
        sendEmailVerification(user)
          .then(success => {
            if (success) {
              showMessage('Verification email resent successfully!', 'success');
            }
          })
          .finally(() => {
            // Reset button state
            btn.disabled = false;
            btn.innerHTML = originalText;
          });
      } else {
        showMessage('You must be logged in to resend verification email', 'warning');
      }
    });
  }
  
  // Add event listener for check verification button
  const checkBtn = document.getElementById('check-verification-btn');
  if (checkBtn) {
    // Remove existing listeners by cloning
    const newCheckBtn = checkBtn.cloneNode(true);
    if (checkBtn.parentNode) {
      checkBtn.parentNode.replaceChild(newCheckBtn, checkBtn);
    }
    
    newCheckBtn.addEventListener('click', function() {
      const user = firebase.auth().currentUser;
      if (user) {
        // Show loading state
        const btn = this;
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Checking...';
        
        // Force token refresh to get latest verification status
        user.reload()
          .then(() => {
            if (user.emailVerified) {
              // Update Firestore user record if needed
              if (firebase.firestore) {
                firebase.firestore().collection('users').doc(user.uid).update({
                  emailVerified: true
                }).catch(err => console.error('Error updating verification status:', err));
              }
              
              // Update local state
              if (authState.userProfile) {
                authState.userProfile.emailVerified = true;
              }
              
              // Hide verification modal
              const modalInstance = bootstrap.Modal.getInstance(modalDiv);
              if (modalInstance) modalInstance.hide();
              
              // Show success message
              showMessage('Email verification successful! Your account is now fully activated.', 'success');
            } else {
              // Still not verified
              showMessage('Your email is not verified yet. Please check your inbox and click the verification link.', 'warning');
            }
          })
          .catch(error => {
            console.error('Error checking verification status:', error);
            showMessage(`Error checking verification status: ${error.message}`, 'danger');
          })
          .finally(() => {
            // Reset button state
            btn.disabled = false;
            btn.innerHTML = originalText;
          });
      }
    });
  }
  
  // Clean up when modal is hidden
  modalDiv.addEventListener('hidden.bs.modal', function() {
    // Clear polling interval if it exists
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    
    // Remove any event listeners to prevent memory leaks
    document.getElementById('resend-verification-btn')?.replaceWith(
      document.getElementById('resend-verification-btn').cloneNode(true)
    );
    document.getElementById('check-verification-btn')?.replaceWith(
      document.getElementById('check-verification-btn').cloneNode(true)
    );
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
  
  // If there's a pending plan selection, add a message to the signup form
  if (mode === 'signup') {
    // Remove any existing message first
    const existingMessage = document.getElementById('signup-pending-message');
    if (existingMessage) {
      existingMessage.remove();
    }
    
    // Check for pending plan
    const pendingPlan = localStorage.getItem('pendingPlanSelection');
    if (pendingPlan) {
      // Create a new message element
      const messageEl = document.createElement('div');
      messageEl.id = 'signup-pending-message';
      messageEl.className = 'alert alert-info mb-3';
      messageEl.innerHTML = `<i class="fas fa-info-circle me-2"></i>You'll be upgrading to the <strong>${pendingPlan.charAt(0).toUpperCase() + pendingPlan.slice(1)} Plan</strong> after creating your account.`;
      
      // Insert at the top of the form
      const signupForm = document.getElementById('signup-form');
      signupForm.insertBefore(messageEl, signupForm.firstChild);
    }
    
    // Check for pending addon purchase
    const pendingAddonStr = localStorage.getItem('pendingAddonPurchase');
    if (pendingAddonStr) {
      try {
        const pendingAddon = JSON.parse(pendingAddonStr);
        const featureType = pendingAddon.featureType;
        const quantity = pendingAddon.quantity || 1;
        
        // Create feature display name mapping
        const featureNames = {
          'resumeAnalyses': 'Resume Analysis',
          'mockInterviews': 'Mock Interview',
          'pdfDownloads': 'PDF Downloads',
          'aiEnhance': 'AI Enhancements'
        };
        
        const featureName = featureNames[featureType] || featureType;
        
        // Create a new message element
        const messageEl = document.createElement('div');
        messageEl.id = 'signup-pending-message';
        messageEl.className = 'alert alert-info mb-3';
        messageEl.innerHTML = `<i class="fas fa-info-circle me-2"></i>You'll be purchasing <strong>${quantity} ${featureName}${quantity > 1 ? 's' : ''}</strong> after creating your account.`;
        
        // Insert at the top of the form
        const signupForm = document.getElementById('signup-form');
        signupForm.insertBefore(messageEl, signupForm.firstChild);
      } catch (e) {
        console.error("Error parsing pending addon data:", e);
      }
    }
  }
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  
  const modalInstance = bootstrap.Modal.getInstance(modal);
  if (modalInstance) {
    modalInstance.hide();
  }
}

// Convenience function for showing sign up modal specifically
function showSignUpModal() {
  showAuthModal('signup');
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

/// --- New function to purchase an addon ---
// function purchaseAddon(featureType, quantity = 1) {
//   const user = firebase.auth().currentUser;
//   if (!user) {
//     showMessage('Please sign in to purchase add-ons', 'warning');
//     return Promise.reject(new Error("Authentication error"));
//   }
  
//   // Define API_BASE_URL if not already defined
//   const API_BASE_URL = 'https://iris-ai-backend.onrender.com'; // Update this URL to match your backend
  
//   return fetch(`${API_BASE_URL}/purchase-addon`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       userId: user.uid,
//       feature: featureType,
//       quantity: quantity
//       // In a real implementation, you would add payment token here
//     })
//   })
//   .then(response => {
//     // Check if the response is JSON
//     const contentType = response.headers.get('content-type');
//     if (!contentType || !contentType.includes('application/json')) {
//       // Handle non-JSON response (like HTML error page)
//       return response.text().then(text => {
//         console.error("Received non-JSON response:", text.substring(0, 200) + "...");
//         throw new Error("The server returned an invalid response. Please try again later.");
//       });
//     }
    
//     // For JSON responses, check if it's successful
//     if (!response.ok) {
//       return response.json().then(errData => {
//         throw new Error(errData.error || `Request failed (${response.status})`);
//       });
//     }
    
//     return response.json();
//   })
//   .then(data => {
//     // Update local state to reflect new limits
//     if (authState && authState.userProfile && authState.userProfile.usage && authState.userProfile.usage[featureType]) {
//       authState.userProfile.usage[featureType].limit = data.newLimit;
//     }
    
//     // Return purchase data
//     return data;
//   });
// }

function purchaseAddon(featureType, quantity = 1) {
  // This function should now trigger the Razorpay flow instead of direct DB update
  // It will be called from app.js purchaseAddonItem function
  
  // We now return a promise that resolves when the purchase is initiated
  // The actual purchase completion will be handled by the verify-razorpay-payment endpoint
  return Promise.resolve({
    initiated: true,
    feature: featureType,
    quantity: quantity
  });
}

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
  
  // NEW: Forgot password link
  document.getElementById('forgot-password-link')?.addEventListener('click', function(e) {
    e.preventDefault();
    // Hide the sign-in modal
    hideAuthModal();
    // Show the password reset modal
    const resetModal = document.getElementById('reset-password-modal');
    if (resetModal) {
      const modalInstance = new bootstrap.Modal(resetModal);
      modalInstance.show();
    }
  });
  
  // NEW: Password reset form submission
  document.getElementById('reset-password-form')?.addEventListener('submit', function(e) {
    e.preventDefault();
    const email = document.getElementById('reset-email').value;
    sendPasswordResetEmail(email);
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

// Function to send password reset email
function sendPasswordResetEmail(email) {
  if (!firebase.auth) {
    showErrorMessage('Authentication service not available');
    return Promise.reject(new Error('Authentication service not available'));
  }
  
  // Show loading state on the button
  const resetBtn = document.querySelector('#reset-password-form button[type="submit"]');
  const originalBtnText = resetBtn ? resetBtn.innerHTML : '';
  if (resetBtn) {
    resetBtn.disabled = true;
    resetBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...';
  }
  
  return firebase.auth().sendPasswordResetEmail(email)
    .then(() => {
      console.log('Password reset email sent successfully');
      
      // Hide the reset modal
      const resetModal = document.getElementById('reset-password-modal');
      if (resetModal) {
        const modalInstance = bootstrap.Modal.getInstance(resetModal);
        if (modalInstance) modalInstance.hide();
      }
      
      // Show success message
      showMessage('Password reset email sent! Check your inbox for instructions.', 'success');
      return true;
    })
    .catch(error => {
      console.error('Error sending password reset email:', error);
      showErrorMessage(`Failed to send password reset email: ${error.message}`);
      return false;
    })
    .finally(() => {
      // Reset button state
      if (resetBtn) {
        resetBtn.disabled = false;
        resetBtn.innerHTML = originalBtnText;
      }
    });
}

function startVerificationPolling(user, modalInstance) {
  if (!user) return null;
  
  console.log('Starting email verification polling for user:', user.email);
  
  // Start a polling interval to check verification status
  const checkInterval = setInterval(() => {
    // Reload the user to get fresh token with updated email verification status
    console.log('Checking verification status...');
    user.reload()
      .then(() => {
        // Check if email is verified
        if (user.emailVerified) {
          console.log('Email verified successfully!');
          
          // Clear the interval
          clearInterval(checkInterval);
          
          // Update Firestore user record if needed
          if (firebase.firestore) {
            firebase.firestore().collection('users').doc(user.uid).update({
              emailVerified: true
            }).catch(err => console.error('Error updating verification status:', err));
          }
          
          // Update local state
          if (authState.userProfile) {
            authState.userProfile.emailVerified = true;
          }
          authState.isEmailVerified = true;
          
          // Hide verification modal
          if (modalInstance) {
            modalInstance.hide();
          }
          
          // Show success message
          showMessage('Email verification successful! Your account is now fully activated.', 'success');
          
          // Process any pending payments that were waiting for verification
          const postVerificationPlan = localStorage.getItem('postVerificationPlan');
          const postVerificationAddon = localStorage.getItem('postVerificationAddon');
          
          if (postVerificationPlan) {
            localStorage.removeItem('postVerificationPlan');
            
            // Give a moment for everything to fully initialize
            setTimeout(() => {
                console.log(`Processing post-verification plan selection: ${postVerificationPlan}`);
                // Trigger plan selection with payment
                if (typeof selectPlanFixed === 'function') {
                    selectPlanFixed(postVerificationPlan);
                } else {
                    console.warn("selectPlanFixed function not found. Cannot process pending plan.");
                    showMessage("Unable to continue with plan selection. Please try again from your profile.", "warning");
                }
            }, 1500);
          } else if (postVerificationAddon) {
            // Process addon purchase if there's no pending plan
            try {
                const pendingAddon = JSON.parse(postVerificationAddon);
                localStorage.removeItem('postVerificationAddon');
                
                setTimeout(() => {
                    console.log(`Processing post-verification addon purchase:`, pendingAddon);
                    if (typeof purchaseAddonItem === 'function') {
                        purchaseAddonItem(pendingAddon.featureType, pendingAddon.quantity);
                    } else {
                        console.warn("purchaseAddonItem function not found. Cannot process pending addon.");
                        showMessage("Unable to continue with add-on purchase. Please try again from your profile.", "warning");
                    }
                }, 1500);
            } catch (e) {
                console.error("Error parsing pending addon data:", e);
                localStorage.removeItem('postVerificationAddon');
            }
          }
        } else {
          console.log('Email not yet verified, continuing to poll...');
        }
      })
      .catch(error => {
        console.error('Error checking email verification status:', error);
        clearInterval(checkInterval); // Stop on error
      });
  }, 5000); // Check every 5 seconds
  
  // Store the interval ID so we can clear it if needed
  return checkInterval;
}

// Add this function before the window.irisAuth export
function sendEmailVerification(user) {
  if (!user) {
    console.warn('Cannot send verification email: No user provided');
    return Promise.resolve(false);
  }
  
  return user.sendEmailVerification()
    .then(() => {
      console.log('Verification email sent successfully');
      return true;
    })
    .catch(error => {
      console.error('Error sending verification email:', error);
      showErrorMessage(`Failed to send verification email: ${error.message}`);
      return false;
    });
}

// Export functions for global use
// Update your irisAuth exported object to include the new functions
window.irisAuth = {
  // Existing functions...
  signIn: signInWithEmailPassword,
  signUp: signUpWithEmailPassword,
  signInWithGoogle,
  signOut,
  getCurrentUser: () => authState.user,
  getUserProfile: () => authState.userProfile,
  showSignInModal: () => showAuthModal('signin'),
  showSignUpModal: () => showAuthModal('signup'),
  canUseFeature,
  incrementUsageCounter,
  updateUserPlan: (planName) => {
    console.log(`Plan update for ${planName} will be processed after payment`);
    return Promise.resolve({ initiated: true, plan: planName });
  },
  getPackageLimit,
  purchaseAddon,
  // Add email verification state getter
  isEmailVerified: () => authState.isEmailVerified || false,
  
  // Add new functions
  sendEmailVerification,
  checkEmailVerification,
  showEmailVerificationModal,
  sendPasswordResetEmail,
};