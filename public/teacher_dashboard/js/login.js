// js/login.js
import { auth } from './config/firebase-config.js'; // Import auth from your config
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
// Import the function that will show the dashboard view
import { showDashboardView } from './modules/auth.js'; // Assuming you put showDashboardView in auth.js

const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('login-button');
const errorMessageDiv = document.getElementById('error-message');

// Auth state listener (now primarily handled by auth.js's checkAuthState)
// This listener might be simplified or removed if checkAuthState handles everything
onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("Auth state change: User logged in.");
        // checkAuthState should handle showing the dashboard if role is correct
    } else {
        console.log("Auth state change: User logged out.");
        // checkAuthState should handle showing the login view
    }
});

// Initial check when the script loads
// Import and call checkAuthState from auth.js
import { checkAuthState } from './modules/auth.js';
checkAuthState('combinedPage'); // Indicate this is the combined page

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // Prevent default form submission

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    errorMessageDiv.textContent = ''; // Clear previous errors
    loginButton.disabled = true; // Disable button during login attempt
    loginButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Signing In...'; // Add loading state

    if (!email || !password) {
        errorMessageDiv.textContent = 'Please enter both email and password.';
        loginButton.disabled = false;
        loginButton.textContent = 'Sign in';
        return;
    }

    try {
        console.log(`Attempting login for: ${email}`);
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        // Signed in
        const user = userCredential.user;
        console.log('Login successful:', user.uid);

        // --- CHANGE: Instead of redirecting, let checkAuthState handle showing the dashboard ---
        // The onAuthStateChanged listener (or the initial checkAuthState call)
        // will detect the logged-in user, verify the role, and call showDashboardView.
        // No explicit redirect or view change needed here anymore.

        // Optional: You might clear the form fields here if desired
        // loginForm.reset();

    } catch (error) {
        console.error('Login Error:', error);
        let friendlyMessage = 'Login failed. Please check your credentials.';
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            friendlyMessage = 'Invalid email or password.';
        } else if (error.code === 'auth/invalid-email') {
            friendlyMessage = 'Please enter a valid email address.';
        } else {
            friendlyMessage = `Login failed: ${error.message}`;
        }
        errorMessageDiv.textContent = friendlyMessage;
        loginButton.disabled = false; // Re-enable button on error
        loginButton.textContent = 'Sign in';
    }
});

// Make sure dashboard specific logic (like logout button) is initialized
// only *after* the dashboard view is shown. This might move to auth.js
// or a separate dashboard initialization function called by auth.js.
import { initializeDashboard } from './dashboard.js'; // Assuming dashboard.js exports this
// initializeDashboard(); // Call this from showDashboardView in auth.js
