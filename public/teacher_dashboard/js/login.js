// js/login.js
import { auth } from './config/firebase-config.js'; // Import auth from your config
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";

const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('login-button');
const errorMessageDiv = document.getElementById('error-message');

// Redirect if user is already logged in
onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("User already logged in, redirecting to dashboard...");
        window.location.href = 'dashboard.html'; // Redirect to dashboard
    } else {
        console.log("No user logged in.");
    }
});

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

        // Redirect to the dashboard page upon successful login
        window.location.href = 'dashboard.html';

    } catch (error) {
        console.error('Login Error:', error);
        // Handle specific errors
        let friendlyMessage = 'Login failed. Please check your credentials.';
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            friendlyMessage = 'Invalid email or password.';
        } else if (error.code === 'auth/invalid-email') {
            friendlyMessage = 'Please enter a valid email address.';
        } else {
            friendlyMessage = `Login failed: ${error.message}`; // More specific error for debugging
        }
        errorMessageDiv.textContent = friendlyMessage;
        loginButton.disabled = false; // Re-enable button on error
        loginButton.textContent = 'Sign in';
    }
});
