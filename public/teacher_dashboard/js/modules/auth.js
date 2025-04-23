// js/modules/auth.js
import { auth } from '../config/firebase-config.js'; // Import auth from your config
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getTeacherProfile } from './firestoreService.js'; // Import function to get teacher details
import { initializeDashboard } from '../dashboard.js'; // Import dashboard init function

// Get references to the main views
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loadingIndicator = document.getElementById('loading-indicator'); // In dashboard view
const dashboardContent = document.getElementById('dashboard-content'); // Actual content inside dashboard view

// Simple state management for the current user
let currentUser = null;
let teacherProfileData = null; // Store teacher-specific data
let dashboardInitialized = false; // Flag to prevent multiple initializations

/**
 * Shows the Login View and hides the Dashboard View.
 */
export function showLoginView() {
    if (loginView) loginView.classList.remove('hidden');
    if (dashboardView) dashboardView.classList.add('hidden');
    dashboardInitialized = false; // Reset dashboard init flag on logout
    // Clear any sensitive dashboard data if necessary
}

/**
 * Shows the Dashboard View and hides the Login View.
 * Also triggers dashboard data loading.
 * @param {object} user - Firebase user object.
 * @param {object} teacherProfile - Fetched teacher profile data.
 */
export function showDashboardView(user, teacherProfile) {
    if (!user || !teacherProfile) {
        console.error("Cannot show dashboard view without user or teacher profile.");
        handleSignOut(); // Sign out if data is missing
        return;
    }
    if (loginView) loginView.classList.add('hidden');
    if (dashboardView) dashboardView.classList.remove('hidden');

    // Update teacher info in the sidebar (or wherever it's displayed)
    const nameEl = document.getElementById('teacher-display-name');
    const emailEl = document.getElementById('teacher-email');
    if(nameEl) nameEl.textContent = teacherProfile.displayName || user.displayName || 'Teacher';
    if(emailEl) emailEl.textContent = user.email;

    // Initialize dashboard components and load data *only once*
    if (!dashboardInitialized) {
        console.log("Initializing dashboard components and loading data...");
        if (loadingIndicator) loadingIndicator.classList.remove('hidden'); // Show loading indicator
        if (dashboardContent) dashboardContent.classList.add('hidden'); // Hide content while loading

        initializeDashboard(teacherProfile); // Pass teacher profile to dashboard init
        dashboardInitialized = true;

        // Hide loading indicator after a short delay or when data is loaded in dashboard.js
        // Example: dashboard.js would hide it in its final .finally() block
    } else {
        // If already initialized, maybe just refresh data?
        console.log("Dashboard already initialized. Skipping re-initialization.");
         // Ensure loading indicator is hidden and content is shown if re-entering
         if (loadingIndicator) loadingIndicator.classList.add('hidden');
         if (dashboardContent) dashboardContent.classList.remove('hidden');
    }
}


/**
 * Checks the current authentication state and shows the appropriate view.
 * @param {'combinedPage'} currentPageType - Indicates this handles both views.
 */
export function checkAuthState(currentPageType) { // currentPageType might become redundant
    console.log(`Checking auth state...`);

    onAuthStateChanged(auth, async (user) => {
        currentUser = user; // Update global state

        if (user) {
            console.log("User is signed in:", user.uid);
            // User is logged in, fetch profile and verify role
            try {
                // Show a temporary loading state if needed, e.g., disable login form if visible
                teacherProfileData = await getTeacherProfile(user.uid);

                if (teacherProfileData && teacherProfileData.role === 'teacher') {
                    console.log("Teacher role verified.");
                    showDashboardView(user, teacherProfileData); // Show dashboard
                } else {
                    // Not a teacher or profile fetch failed/missing role
                    console.error("User is not authorized as a teacher or profile missing/invalid.");
                    // Show error on login page if possible
                    const errorMessageDiv = document.getElementById('error-message');
                    if(errorMessageDiv) errorMessageDiv.textContent = "Access Denied: Not an authorized teacher account.";
                    // Ensure login view is shown
                    showLoginView();
                    await handleSignOut(); // Sign out unauthorized user
                }
            } catch (error) {
                console.error("Error verifying teacher role:", error);
                 const errorMessageDiv = document.getElementById('error-message');
                 if(errorMessageDiv) errorMessageDiv.textContent = "Error verifying access. Please try again.";
                 showLoginView(); // Show login on error
                 await handleSignOut(); // Sign out on error
            }
        } else {
            // User is signed out
            console.log("User is signed out.");
            currentUser = null;
            teacherProfileData = null;
            showLoginView(); // Show the login view
        }
    });
}

/**
 * Handles the sign-out process.
 */
export async function handleSignOut() {
    try {
        console.log("Signing out...");
        await firebaseSignOut(auth);
        currentUser = null;
        teacherProfileData = null;
        dashboardInitialized = false; // Reset init flag
        console.log("Sign out successful.");
        showLoginView(); // Explicitly show login view after sign out
    } catch (error) {
        console.error('Sign Out Error:', error);
        alert(`Error signing out: ${error.message}`);
    }
}

// getCurrentUser and getTeacherData remain the same
export function getCurrentUser() { return currentUser; }
export function getTeacherData() { return teacherProfileData; }

