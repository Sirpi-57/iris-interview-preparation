// js/login.js
import { auth } from './config/firebase-config.js'; 
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { checkAuthState } from './modules/auth.js';

const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('login-button');
const errorMessageDiv = document.getElementById('error-message');

// Initial check when the script loads
checkAuthState('combinedPage'); 

// Listen for form submission event
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevent default form submission - CRITICAL

        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();
        
        if (errorMessageDiv) errorMessageDiv.textContent = ''; // Clear previous errors
        if (loginButton) {
            loginButton.disabled = true; // Disable button during login attempt
            loginButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Signing In...'; // Add loading state
        }

        if (!email || !password) {
            if (errorMessageDiv) errorMessageDiv.textContent = 'Please enter both email and password.';
            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = 'Sign in';
            }
            return;
        }

        try {
            console.log(`Attempting login for: ${email}`);
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            console.log('Login successful:', userCredential.user.uid);
            // Auth state listener will handle the rest
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
            
            if (errorMessageDiv) errorMessageDiv.textContent = friendlyMessage;
            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = 'Sign in';
            }
        }
    });
} else {
    console.error("Login form element not found!");
}