// js/modules/auth.js
import { auth } from '../config/firebase-config.js'; // Fix relative path
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getTeacherProfile } from './firestoreService.js'; 
import { initializeDashboard } from '../dashboard.js'; 

// Get references to the main views
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loadingIndicator = document.getElementById('loading-indicator'); 
const dashboardContent = document.getElementById('dashboard-content'); 

// Simple state management for the current user
let currentUser = null;
let teacherProfileData = null; 
let dashboardInitialized = false; 

/**
 * Shows the Login View and hides the Dashboard View.
 */
export function showLoginView() {
    if (loginView) loginView.classList.remove('hidden');
    if (dashboardView) dashboardView.classList.add('hidden');
    dashboardInitialized = false; 
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
        handleSignOut(); 
        return;
    }
    if (loginView) loginView.classList.add('hidden');
    if (dashboardView) dashboardView.classList.remove('hidden');

    // Update teacher info in the sidebar
    const nameEl = document.getElementById('teacher-display-name');
    const emailEl = document.getElementById('teacher-email');
    if(nameEl) nameEl.textContent = teacherProfile.displayName || user.displayName || 'Teacher';
    if(emailEl) emailEl.textContent = user.email;

    // Initialize dashboard components and load data *only once*
    if (!dashboardInitialized) {
        console.log("Initializing dashboard components and loading data...");
        if (loadingIndicator) loadingIndicator.classList.remove('hidden'); 
        if (dashboardContent) dashboardContent.classList.add('hidden'); 

        initializeDashboard(teacherProfile); 
        dashboardInitialized = true;
    } else {
        console.log("Dashboard already initialized. Skipping re-initialization.");
        if (loadingIndicator) loadingIndicator.classList.add('hidden');
        if (dashboardContent) dashboardContent.classList.remove('hidden');
    }
}

/**
 * Checks the current authentication state and shows the appropriate view.
 * @param {'combinedPage'} currentPageType - Indicates this handles both views.
 */
export function checkAuthState(currentPageType) { 
    console.log(`Checking auth state...`);

    onAuthStateChanged(auth, async (user) => {
        currentUser = user; 

        if (user) {
            console.log("User is signed in:", user.uid);
            try {
                teacherProfileData = await getTeacherProfile(user.uid);

                if (teacherProfileData && teacherProfileData.role === 'teacher') {
                    console.log("Teacher role verified.");
                    showDashboardView(user, teacherProfileData); 
                } else {
                    console.error("User is not authorized as a teacher or profile missing/invalid.");
                    const errorMessageDiv = document.getElementById('error-message');
                    if(errorMessageDiv) errorMessageDiv.textContent = "Access Denied: Not an authorized teacher account.";
                    showLoginView();
                    await handleSignOut(); 
                }
            } catch (error) {
                console.error("Error verifying teacher role:", error);
                 const errorMessageDiv = document.getElementById('error-message');
                 if(errorMessageDiv) errorMessageDiv.textContent = "Error verifying access. Please try again.";
                 showLoginView(); 
                 await handleSignOut(); 
            }
        } else {
            console.log("User is signed out.");
            currentUser = null;
            teacherProfileData = null;
            showLoginView(); 
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
        dashboardInitialized = false; 
        console.log("Sign out successful.");
        showLoginView(); 
    } catch (error) {
        console.error('Sign Out Error:', error);
        alert(`Error signing out: ${error.message}`);
    }
}

// Export user data access functions
export function getCurrentUser() { return currentUser; }
export function getTeacherData() { return teacherProfileData; }