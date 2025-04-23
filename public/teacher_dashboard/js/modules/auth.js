// js/modules/auth.js
import { auth } from '../config/firebase-config.js'; // Import auth from your config
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getTeacherProfile } from './firestoreService.js'; // Import function to get teacher details

// Simple state management for the current user
let currentUser = null;
let teacherProfileData = null; // Store teacher-specific data

/**
 * Checks the current authentication state and redirects if necessary.
 * Acts as an Auth Guard.
 * @param {'loginPage' | 'dashboardPage'} currentPageType - Indicates which page is currently loaded.
 */
export function checkAuthState(currentPageType) {
    console.log(`Checking auth state for: ${currentPageType}`);
    const loadingIndicator = document.getElementById('loading-indicator');
    const dashboardContent = document.getElementById('dashboard-content');

    // Show loading indicator initially on dashboard page
    if (currentPageType === 'dashboardPage' && loadingIndicator) {
        loadingIndicator.classList.remove('hidden');
        if(dashboardContent) dashboardContent.classList.add('hidden');
    }

    onAuthStateChanged(auth, async (user) => {
        currentUser = user; // Update global state

        if (user) {
            console.log("User is signed in:", user.uid);
            // User is logged in
            if (currentPageType === 'loginPage') {
                // If on login page, redirect to dashboard
                console.log("Redirecting from login to dashboard...");
                window.location.href = 'dashboard.html';
            } else if (currentPageType === 'dashboardPage') {
                 // If on dashboard page, fetch teacher profile and verify role
                 try {
                    teacherProfileData = await getTeacherProfile(user.uid);

                    if (teacherProfileData && teacherProfileData.role === 'teacher') {
                        console.log("Teacher role verified.");
                        // Update UI with teacher info
                        const nameEl = document.getElementById('teacher-display-name');
                        const emailEl = document.getElementById('teacher-email');
                        if(nameEl) nameEl.textContent = teacherProfileData.displayName || user.displayName || 'Teacher';
                        if(emailEl) emailEl.textContent = user.email;

                        // Hide loading, show content
                        if (loadingIndicator) loadingIndicator.classList.add('hidden');
                        if (dashboardContent) dashboardContent.classList.remove('hidden');

                        // Trigger data loading for the dashboard now that we know it's a teacher
                        if (window.loadDashboardData) {
                            window.loadDashboardData(teacherProfileData); // Pass profile data
                        }

                    } else {
                        // Not a teacher or profile fetch failed
                        console.error("User is not authorized as a teacher or profile missing.");
                        alert("Access Denied: You are not authorized to view this dashboard.");
                        await handleSignOut(); // Sign out unauthorized user
                    }
                 } catch (error) {
                    console.error("Error verifying teacher role:", error);
                    alert("An error occurred while verifying your access.");
                    await handleSignOut();
                 }
            }
        } else {
            // User is signed out
            console.log("User is signed out.");
            currentUser = null;
            teacherProfileData = null;
            if (currentPageType === 'dashboardPage') {
                // If on dashboard page, redirect to login
                console.log("Redirecting from dashboard to login...");
                window.location.href = 'index.html';
            } else if (currentPageType === 'loginPage') {
                 // If on login page, ensure loading indicators are hidden (if any were added)
                 // No action needed by default for login page when logged out
            }
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
        console.log("Sign out successful.");
        // Auth state listener will handle redirect to login page
    } catch (error) {
        console.error('Sign Out Error:', error);
        alert(`Error signing out: ${error.message}`);
    }
}

/**
 * Gets the currently logged-in user object from Firebase Auth.
 * @returns {object | null} Firebase User object or null.
 */
export function getCurrentUser() {
    return currentUser;
}

/**
 * Gets the fetched teacher profile data (role, assignments).
 * @returns {object | null} Teacher profile object or null.
 */
export function getTeacherData() {
    return teacherProfileData;
}
