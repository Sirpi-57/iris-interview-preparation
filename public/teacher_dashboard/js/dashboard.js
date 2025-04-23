// js/dashboard.js
// Note: checkAuthState is now handled in login.js (or your main app script)
import { handleSignOut, getTeacherData } from './modules/auth.js';
import { getAssignedStudents, getStudentSessions, getStudentInterviews } from './modules/firestoreService.js';
import { displayStudentList, displayStudentDetailsModal, setupStudentListEventListeners, clearStudentDetailsModal } from './modules/ui.js';
import { displayOverallStats, destroyCharts } from './modules/charts.js';

// DOM Elements (ensure these IDs exist in the combined index.html's dashboard-view)
const logoutButton = document.getElementById('logout-button');
const studentListBody = document.getElementById('student-list-body');
const studentListLoading = document.getElementById('student-list-loading');
const studentListEmpty = document.getElementById('student-list-empty');
const studentSearchInput = document.getElementById('student-search');
const overviewSection = document.getElementById('overview-section');
const studentsSection = document.getElementById('students-section');
// Select nav links specifically within the dashboard view to avoid conflicts
const navLinks = document.querySelectorAll('#dashboard-view .nav-link');
const closeModalButton = document.getElementById('close-modal-button');
const studentDetailModal = document.getElementById('student-detail-modal');
const loadingIndicator = document.getElementById('loading-indicator');
const dashboardContent = document.getElementById('dashboard-content');


let allStudents = []; // Store all fetched students for filtering
let currentTeacherProfile = null;

/**
 * Initializes the dashboard: sets up listeners and loads initial data.
 * This is now called by auth.js after successful login and role verification.
 * @param {object} teacherData - The verified teacher's profile data.
 */
export function initializeDashboard(teacherData) {
    console.log("Initializing Dashboard...");
    currentTeacherProfile = teacherData; // Store teacher profile

    // Add event listeners (ensure they are added only once)
    if (logoutButton && !logoutButton.dataset.listenerAttached) {
        logoutButton.addEventListener('click', handleSignOut);
        logoutButton.dataset.listenerAttached = 'true'; // Mark as attached
    }
    if (studentSearchInput && !studentSearchInput.dataset.listenerAttached) {
        studentSearchInput.addEventListener('input', handleStudentSearch);
         studentSearchInput.dataset.listenerAttached = 'true';
    }
    if (closeModalButton && studentDetailModal && !closeModalButton.dataset.listenerAttached) {
        closeModalButton.addEventListener('click', () => {
            studentDetailModal.classList.add('hidden');
            clearStudentDetailsModal();
        });
         closeModalButton.dataset.listenerAttached = 'true';

        // Optional: Close modal if clicking outside
        studentDetailModal.addEventListener('click', (event) => {
            if (event.target === studentDetailModal) {
                 studentDetailModal.classList.add('hidden');
                 clearStudentDetailsModal();
            }
        });
    }

    // Setup navigation between dashboard sections
    setupNavigation();

    // Load initial data
    loadInitialDashboardData();
}


// --- Load Initial Data ---
async function loadInitialDashboardData() {
     if (!currentTeacherProfile) {
        console.error("Teacher profile data is missing, cannot load dashboard data.");
        if(dashboardContent) dashboardContent.innerHTML = '<p class="text-red-500 text-center p-4">Error: Could not load teacher data.</p>';
        if(loadingIndicator) loadingIndicator.classList.add('hidden');
        if(dashboardContent) dashboardContent.classList.remove('hidden');
        return;
    }

    try {
        // Fetch assigned students
        allStudents = await getAssignedStudents(currentTeacherProfile);

        // Display students in the table
        displayStudentList(allStudents, studentListBody, studentListLoading, studentListEmpty);

        // Setup event listeners for the student rows
        setupStudentListEventListeners(handleViewStudentDetails);

        // Calculate and display overview stats
        displayOverallStats(allStudents); // This will also render the chart

        // Initial display: Show overview section
        showSection('overview-section'); // Make overview visible by default

    } catch (error) {
        console.error("Error loading dashboard data:", error);
        if(dashboardContent) dashboardContent.innerHTML = `<p class="text-red-500 text-center p-4">Error loading dashboard data: ${error.message}. Check console.</p>`;
    } finally {
        // Hide loading indicator and show content area
        if(loadingIndicator) loadingIndicator.classList.add('hidden');
        if(dashboardContent) dashboardContent.classList.remove('hidden');
    }
}

// --- Event Handlers ---
function handleStudentSearch(event) {
    const searchTerm = event.target.value.toLowerCase();
    const filteredStudents = allStudents.filter(student => {
        const name = student.displayName?.toLowerCase() || '';
        const email = student.email?.toLowerCase() || '';
        return name.includes(searchTerm) || email.includes(searchTerm);
    });
    displayStudentList(filteredStudents, studentListBody, studentListLoading, studentListEmpty);
    setupStudentListEventListeners(handleViewStudentDetails); // Re-attach listeners after re-render
}

async function handleViewStudentDetails(studentId) {
    console.log(`Viewing details for student: ${studentId}`);
    const studentData = allStudents.find(s => s.id === studentId);
    if (!studentData) {
        console.error("Student data not found for ID:", studentId);
        alert("Could not find student data.");
        return;
    }

    if (studentDetailModal) studentDetailModal.classList.remove('hidden');
    clearStudentDetailsModal(); // Clear previous content and show loader

    try {
        const [sessions, interviews] = await Promise.all([
            getStudentSessions(studentId),
            getStudentInterviews(studentId)
        ]);
        console.log(`Fetched ${sessions.length} sessions and ${interviews.length} interviews for ${studentData.displayName}`);
        displayStudentDetailsModal(studentData, sessions, interviews);
    } catch (error) {
        console.error("Error fetching student details:", error);
        const modalBody = document.getElementById('modal-body');
        if(modalBody) modalBody.innerHTML = `<p class="text-red-500 text-center">Error loading details: ${error.message}</p>`;
    }
}


// --- Navigation Logic ---
function setupNavigation() {
    // Ensure listener is attached only once using a flag or by querying within dashboard view
    // Select the NAV element within the dashboard view specifically
    const dashboardNav = document.querySelector('#dashboard-view nav');
    if (dashboardNav && !dashboardNav.dataset.listenerAttached) {
         dashboardNav.addEventListener('click', (e) => {
            // Use closest to handle clicks on icons inside the link
            const link = e.target.closest('.nav-link');
            if (!link) return; // Exit if click wasn't on a nav link

            e.preventDefault(); // Prevent default anchor link behavior
            const targetId = link.getAttribute('data-target');
            if (!targetId) return; // Exit if no target specified

            // Remove active class from all links and sections within the dashboard view
            document.querySelectorAll('#dashboard-view .nav-link').forEach(l => l.classList.remove('active', 'bg-indigo-600'));
            document.querySelectorAll('#dashboard-view .dashboard-section').forEach(s => s.classList.add('hidden')); // Hide all sections

            // Add active class to the clicked link
            link.classList.add('active', 'bg-indigo-600');

            // Show the target section and handle associated actions (like charts)
            showSection(targetId);
        });
        dashboardNav.dataset.listenerAttached = 'true'; // Mark listener as attached
        console.log("Dashboard navigation listener attached.");
    } else if (!dashboardNav) {
         console.error("Dashboard navigation container (nav element) not found.");
    } else {
         console.log("Dashboard navigation listener already attached.");
    }
}

/**
 * Shows a specific dashboard section and hides others.
 * Also handles chart destruction/re-rendering.
 * @param {string} sectionId - The ID of the section to show (e.g., 'overview-section').
 */
function showSection(sectionId) {
     const sectionToShow = document.getElementById(sectionId);

     if (sectionToShow) {
        // Hide all dashboard sections first
        document.querySelectorAll('#dashboard-view .dashboard-section').forEach(s => {
            if (s.id !== sectionId) { // Don't hide the target section
                s.classList.add('hidden');
            }
        });

        // Show the target section
        sectionToShow.classList.remove('hidden');
        console.log(`Navigated to section: ${sectionId}`);

        // Handle chart visibility based on section
        if (sectionId !== 'overview-section') {
             destroyCharts(); // Destroy chart if navigating away from overview
        } else {
            // If navigating TO overview, ensure chart is rendered (if data exists)
            if (allStudents.length > 0) {
                const chartCanvas = document.getElementById('progressChart');
                if (chartCanvas) {
                    // displayOverallStats will handle checking if chart exists and rendering
                    displayOverallStats(allStudents);
                } else {
                    console.warn("Chart canvas not found when trying to show overview section.");
                }
            } else {
                 // If no student data, ensure chart area is cleared or shows message
                 destroyCharts(); // Ensure any old chart is gone
                 const chartCanvas = document.getElementById('progressChart');
                 if(chartCanvas) {
                    const ctx = chartCanvas.getContext('2d');
                    ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
                    ctx.textAlign = 'center';
                    ctx.fillStyle = '#6b7280'; // gray-500
                    ctx.fillText('No student data available for chart.', chartCanvas.width / 2, 50);
                 }
            }
        }

     } else {
        console.warn(`Navigation target section not found: ${sectionId}`);
        // Optionally default to showing the overview section if target is invalid
        // showSection('overview-section');
     }
}

// --- End of dashboard.js ---