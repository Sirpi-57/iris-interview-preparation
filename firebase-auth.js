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
      loadUserProfile(user); // This now becomes crucial for loading the session ID
      showAppView();
      updateUserProfileUI(user);
    } else {
      authState.userProfile = null;
      // localStorage.removeItem('irisSessionId'); // <<< REMOVE THIS LINE
      const resumeInput = document.getElementById('resumeFile'); // Keep form reset
      const jobDescriptionInput = document.getElementById('jobDescription');
      if (resumeInput) resumeInput.value = null;
      if (jobDescriptionInput) jobDescriptionInput.value = '';
      const progressContainer = document.getElementById('uploadProgress'); // Keep progress reset
       if (progressContainer) { /* ... reset progress bar ... */ }
      showPublicView();
      clearUserProfileUI();
    }
  }
  
  function loadUserProfile(user) {
    // Only load if we have a valid user and Firestore is available
    if (!user || !firebase.firestore) return;
    
    const db = firebase.firestore();
    db.collection('users').doc(user.uid)
      .get()
      .then(doc => {
        if (doc.exists) {
          authState.userProfile = doc.data();
          console.log('User profile loaded:', authState.userProfile);
          updateUserProfileUI(user);
        } else {
          // Create a new user profile if none exists
          console.log('No user profile found, creating one');
          const newProfile = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || user.email.split('@')[0],
            photoURL: user.photoURL,
            createdAt: new Date().toISOString(),
            // Default to free plan for now
            plan: 'free',
            // Add other default fields as needed
          };
          
          // Save the new profile
          db.collection('users').doc(user.uid)
            .set(newProfile)
            .then(() => {
              authState.userProfile = newProfile;
              updateUserProfileUI(user);
            })
            .catch(error => {
              console.error('Error creating user profile:', error);
            });
        }
      })
      .catch(error => {
        console.error('Error loading user profile:', error);
      });
  }
  
  // Replace this entire function in firebase-auth.js
  function updateUserProfileUI(user) {
    // Update UI elements showing user info
    const userDisplayElements = document.querySelectorAll('.user-display-name');
    const userEmailElements = document.querySelectorAll('.user-email');
    const userAvatarElements = document.querySelectorAll('.user-avatar');

    const displayName = user.displayName || authState.userProfile?.displayName || user.email.split('@')[0];
    const email = user.email;
    const photoURL = user.photoURL || 'https://i.stack.imgur.com/34AD2.jpg'; // Default avatar

    userDisplayElements.forEach(el => el.textContent = displayName);
    userEmailElements.forEach(el => el.textContent = email);
    userAvatarElements.forEach(el => {
        if (el.tagName === 'IMG') {
            el.src = photoURL;
            el.alt = displayName;
        }
    });

    // Update plan info if available
    const planElements = document.querySelectorAll('.user-plan');
    const userPlanBadgeElements = document.querySelectorAll('.user-plan-badge'); // Added selector for sidebar badge
    if (authState.userProfile && (planElements.length > 0 || userPlanBadgeElements.length > 0)) {
        const planName = authState.userProfile.plan || 'free';
        const formattedPlanName = planName.charAt(0).toUpperCase() + planName.slice(1);
        planElements.forEach(el => el.textContent = formattedPlanName);
        userPlanBadgeElements.forEach(el => el.textContent = formattedPlanName); // Update sidebar badge too
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

        console.log("User providers:", user.providerData.map(p => p.providerId)); // For debugging
        console.log("Password provider exists:", hasPasswordProvider); // For debugging
    } else {
        // Ensure buttons are hidden if user/elements aren't ready
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