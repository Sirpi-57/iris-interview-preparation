// js/login.js (Teacher Dashboard)

// --- Imports ---
// Firebase SDK functions
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
// Local modules
import { auth } from './config/firebase-config.js'; // Firebase auth instance
import { checkAuthState, showLoginView } from './modules/auth.js'; // Auth state checker and view switcher

// --- DOM Elements ---
// Login Form Elements
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('login-button');
const loginErrorMessageDiv = document.getElementById('error-message'); // Renamed for clarity
const loginFormContainer = document.getElementById('login-form'); // Container for login form itself

// Teacher Signup Form Elements (Added)
const teacherSignupForm = document.getElementById('teacher-signup-form');
const teacherSignupErrorMessage = document.getElementById('teacher-signup-error-message');
const teacherSignupButton = document.getElementById('teacher-signup-button');
const teacherSignupView = document.getElementById('teacher-signup-view');

// Links to switch between forms (Added)
const showTeacherSignupLink = document.getElementById('show-teacher-signup-link');
const showLoginLink = document.getElementById('show-login-link');

// --- Constants ---
const API_BASE_URL_TEACHER = 'https://iris-ai-backend.onrender.com'; // Use your actual backend URL

// --- Initial Auth State Check ---
// Checks if user is already logged in when the page loads
checkAuthState('combinedPage'); // 'combinedPage' indicates this handles both login/dashboard views initially

// --- Function to Toggle Forms --- (Added)
function showTeacherSignupForm(show) {
    const formTitle = document.getElementById('form-title'); // Optional: Update title
    if (teacherSignupView) teacherSignupView.style.display = show ? 'block' : 'none';
    if (loginFormContainer) loginFormContainer.style.display = show ? 'none' : 'block';
    if (formTitle) formTitle.textContent = show ? 'Create Teacher Account' : 'Please sign in to continue';
    // Clear error messages when switching
    if (loginErrorMessageDiv) loginErrorMessageDiv.textContent = '';
    if (teacherSignupErrorMessage) teacherSignupErrorMessage.textContent = '';
}

// --- Event Listeners for Switching Forms --- (Added)
showTeacherSignupLink?.addEventListener('click', (e) => {
    e.preventDefault();
    showTeacherSignupForm(true);
});

showLoginLink?.addEventListener('click', (e) => {
    e.preventDefault();
    showTeacherSignupForm(false);
});

// --- Login Form Logic --- (Original + Minor Rename)
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevent default form submission

        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        // Use the specific error message div for login
        if (loginErrorMessageDiv) loginErrorMessageDiv.textContent = ''; // Clear previous errors
        if (loginButton) {
            loginButton.disabled = true; // Disable button during login attempt
            loginButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Signing In...'; // Add loading state
        }

        if (!email || !password) {
            if (loginErrorMessageDiv) loginErrorMessageDiv.textContent = 'Please enter both email and password.';
            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = 'Sign in';
            }
            return;
        }

        try {
            console.log(`Attempting login for: ${email}`);
            // Use Firebase client-side SDK for login
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            console.log('Login successful:', userCredential.user.uid);
            // Auth state listener (in auth.js -> checkAuthState) will handle showing the dashboard after role check
        } catch (error) {
            console.error('Login Error:', error);
            let friendlyMessage = 'Login failed. Please check your credentials.';

            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                friendlyMessage = 'Invalid email or password.';
            } else if (error.code === 'auth/invalid-email') {
                friendlyMessage = 'Please enter a valid email address.';
            } else if (error.code === 'auth/too-many-requests') {
                 friendlyMessage = 'Access temporarily disabled due to too many failed login attempts. Please reset your password or try again later.';
            }
            else {
                friendlyMessage = `Login failed: ${error.message}`;
            }

            if (loginErrorMessageDiv) loginErrorMessageDiv.textContent = friendlyMessage;
            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = 'Sign in';
            }
        }
    });
} else {
    console.error("Login form element (#login-form) not found!");
}

// --- Teacher Signup Form Logic --- (Added)
if (teacherSignupForm) {
    teacherSignupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('teacher-signup-name')?.value.trim();
        const email = document.getElementById('teacher-signup-email')?.value.trim();
        const password = document.getElementById('teacher-signup-password')?.value; // Don't trim password
        const secretKey = document.getElementById('teacher-secret-key')?.value; // Don't trim secret key

        // Basic Client-Side Validation
        if (!name || !email || !password || !secretKey) {
            if (teacherSignupErrorMessage) teacherSignupErrorMessage.textContent = 'Please fill in all fields.';
            return;
        }
         if (password.length < 6) {
            if (teacherSignupErrorMessage) teacherSignupErrorMessage.textContent = 'Password must be at least 6 characters.';
            return;
         }

        if (teacherSignupErrorMessage) teacherSignupErrorMessage.textContent = ''; // Clear previous errors
        if (teacherSignupButton) {
            teacherSignupButton.disabled = true;
            teacherSignupButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Creating...';
        }

        try {
            // Call the backend endpoint to create the teacher account
            const response = await fetch(`${API_BASE_URL_TEACHER}/create_teacher_account`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    displayName: name,
                    email: email,
                    password: password,
                    secretKey: secretKey // Send the secret key to the backend
                })
            });

            const data = await response.json(); // Attempt to parse JSON regardless of status

            if (!response.ok) {
                // Throw error with message from backend if available
                throw new Error(data.error || `Teacher account creation failed (${response.status})`);
            }

            // Success
            console.log('Teacher account created via backend:', data);
            alert('Teacher account created successfully! Please log in.'); // Simple feedback
            showTeacherSignupForm(false); // Switch back to the login form
            teacherSignupForm.reset(); // Clear the signup form fields

        } catch (error) {
            console.error('Teacher Signup Error:', error);
            if (teacherSignupErrorMessage) teacherSignupErrorMessage.textContent = error.message;
        } finally {
             if (teacherSignupButton) {
                 teacherSignupButton.disabled = false;
                 teacherSignupButton.textContent = 'Create Teacher Account';
             }
        }
    });
} else {
     console.error("Teacher signup form element (#teacher-signup-form) not found!");
}

// --- End of teacher signup code ---