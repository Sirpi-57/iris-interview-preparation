// js/dashboard.js (Teacher Dashboard)

// --- Imports ---
// Existing imports
import { handleSignOut, getTeacherData, getCurrentUser } from './modules/auth.js'; // Added getCurrentUser
import { getAssignedStudents, getStudentSessions, getStudentInterviews } from './modules/firestoreService.js';
import { displayStudentList, displayStudentDetailsModal, setupStudentListEventListeners, clearStudentDetailsModal } from './modules/ui.js';
import { displayOverallStats, destroyCharts } from './modules/charts.js';

// --- Constants ---
const API_BASE_URL_DASHBOARD = 'https://iris-ai-backend.onrender.com'; // Use your actual backend URL

// --- DOM Elements ---
// Existing DOM elements
const logoutButton = document.getElementById('logout-button');
const studentListBody = document.getElementById('student-list-body');
const studentListLoading = document.getElementById('student-list-loading');
const studentListEmpty = document.getElementById('student-list-empty');
const studentSearchInput = document.getElementById('student-search');
const overviewSection = document.getElementById('overview-section');
const studentsSection = document.getElementById('students-section');
const closeModalButton = document.getElementById('close-modal-button'); // For student detail modal
const studentDetailModal = document.getElementById('student-detail-modal');
const loadingIndicator = document.getElementById('loading-indicator');
const dashboardContent = document.getElementById('dashboard-content');
// Assignment Modal elements (ensure these IDs match your HTML)
const assignmentModal = document.getElementById('teacher-assignment-modal');
const assignmentForm = document.getElementById('teacher-assignment-form');
const assignmentErrorMsgDiv = document.getElementById('assignment-error-message');
const assignmentSaveBtn = document.getElementById('save-assignment-details-btn');

// --- State Variables ---
let allStudents = []; // Store all fetched students for filtering
let currentTeacherProfile = null; // Store the logged-in teacher's profile data

// --- Initialization Function (Modified) ---
/**
 * Initializes the dashboard: sets up listeners and loads initial data.
 * Called by auth.js after successful login and role verification.
 * @param {object} teacherData - The verified teacher's profile data.
 */
export function initializeDashboard(teacherData) {
    console.log("Initializing Dashboard...");
    currentTeacherProfile = teacherData; // Store teacher profile

    // Add event listeners (ensure they are added only once)
    if (logoutButton && !logoutButton.dataset.listenerAttached) {
        logoutButton.addEventListener('click', handleSignOut);
        logoutButton.dataset.listenerAttached = 'true';
    }
    if (studentSearchInput && !studentSearchInput.dataset.listenerAttached) {
        studentSearchInput.addEventListener('input', handleStudentSearch);
         studentSearchInput.dataset.listenerAttached = 'true';
    }
    // Listener for the student detail modal close button
    if (closeModalButton && studentDetailModal && !closeModalButton.dataset.listenerAttached) {
        closeModalButton.addEventListener('click', () => {
            studentDetailModal.classList.add('hidden');
            clearStudentDetailsModal();
        });
         closeModalButton.dataset.listenerAttached = 'true';

        // Optional: Close student detail modal if clicking outside
        studentDetailModal.addEventListener('click', (event) => {
            if (event.target === studentDetailModal) {
                 studentDetailModal.classList.add('hidden');
                 clearStudentDetailsModal();
            }
        });
    }

    // NEW: Setup listener for the assignment details modal form
    setupAssignmentModalListener();

    // NEW: Check if assignment details are missing and show modal if needed
    checkAndPromptForAssignmentDetails(teacherData);

    // Setup navigation between dashboard sections
    setupNavigation();

    // Load initial dashboard data (now checks if assignment details are present)
    loadInitialDashboardData();
}

// --- NEW: Assignment Modal Functions ---

/**
 * Checks if assignment details are present in the teacher profile and shows the modal if not.
 * @param {object} teacherData - The teacher's profile data.
 */
function checkAndPromptForAssignmentDetails(teacherData) {
    if (!teacherData) return;
    // Check if any of the required assignment fields are missing/null/empty
    if (!teacherData.assignedCollegeId || !teacherData.assignedDeptId || !teacherData.assignedSectionId) {
        console.log("Teacher assignment details missing. Showing modal.");
        if (assignmentModal) {
            assignmentModal.classList.remove('hidden');
             // Optionally prevent background scroll while modal is open
             // document.body.style.overflow = 'hidden';
        } else {
            console.error("Teacher assignment modal (#teacher-assignment-modal) not found in HTML.");
            // Handle this critical error - maybe show a general error message?
            if (dashboardContent) dashboardContent.innerHTML = '<p class="text-red-500 text-center p-4">Error: UI setup incomplete. Cannot proceed.</p>';
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
        }
    } else {
        console.log("Teacher assignment details found:", teacherData.assignedCollegeId, teacherData.assignedDeptId, teacherData.assignedSectionId);
         // Ensure modal is hidden if details are somehow already present
         if (assignmentModal) assignmentModal.classList.add('hidden');
         // Restore background scroll if it was disabled
         // document.body.style.overflow = '';
    }
}

/**
 * Sets up the event listener for the assignment details form submission.
 */
function setupAssignmentModalListener() {
    if (assignmentForm && !assignmentForm.dataset.listenerAttached) { // Prevent multiple listeners
        assignmentForm.addEventListener('submit', handleSaveAssignmentDetails);
        assignmentForm.dataset.listenerAttached = 'true';
        console.log("Assignment modal listener attached.");
    }
}

/**
 * Handles the submission of the teacher assignment details form.
 * Gets ID token, calls backend endpoint, updates local state, hides modal.
 * @param {Event} event - The form submission event.
 */
async function handleSaveAssignmentDetails(event) {
    event.preventDefault(); // Prevent default form submission

    if (assignmentErrorMsgDiv) assignmentErrorMsgDiv.textContent = ''; // Clear previous errors

    // Get form values
    const collegeId = document.getElementById('assignedCollegeId')?.value.trim();
    const deptId = document.getElementById('assignedDeptId')?.value.trim();
    const sectionId = document.getElementById('assignedSectionId')?.value.trim();

    // Basic validation
    if (!collegeId || !deptId || !sectionId) {
        if (assignmentErrorMsgDiv) assignmentErrorMsgDiv.textContent = 'All fields are required.';
        return;
    }

    // Get current Firebase user from auth module
    const user = getCurrentUser();
    if (!user) {
        if (assignmentErrorMsgDiv) assignmentErrorMsgDiv.textContent = 'Authentication error. Please re-login.';
        // Maybe force logout? handleSignOut();
        return;
    }

    // Disable button and show loading state
    if (assignmentSaveBtn) {
        assignmentSaveBtn.disabled = true;
        assignmentSaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';
    }

    try {
        // --- 1. Get Firebase ID Token ---
        const token = await user.getIdToken();

        // --- 2. Call Backend Endpoint ---
        console.log("Sending assignment details to backend:", { collegeId, deptId, sectionId });
        const response = await fetch(`${API_BASE_URL_DASHBOARD}/update_assignment_details`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // Send the token
            },
            body: JSON.stringify({
                collegeId: collegeId,
                deptId: deptId,
                sectionId: sectionId
            })
        });

        const data = await response.json(); // Try parsing JSON even on error

        if (!response.ok) {
            throw new Error(data.error || `Failed to save details (${response.status})`);
        }

        // --- 3. Update Local State ---
        console.log("Assignment details saved successfully via backend.");
        if (currentTeacherProfile) {
            currentTeacherProfile.assignedCollegeId = collegeId;
            currentTeacherProfile.assignedDeptId = deptId;
            currentTeacherProfile.assignedSectionId = sectionId;
            console.log("Updated local teacher profile:", currentTeacherProfile);
        } else {
            console.warn("currentTeacherProfile was null, cannot update local state.");
            // Maybe try fetching profile again? Or rely on page reload?
        }

        // --- 4. Update UI ---
        if (assignmentModal) assignmentModal.classList.add('hidden'); // Hide modal
         // document.body.style.overflow = ''; // Restore background scroll

        alert("Assignment details saved successfully!"); // Simple feedback for now

        // --- 5. Reload Dashboard Data ---
        // Now that details are saved, reload the main dashboard content (students, stats)
        loadInitialDashboardData();

    } catch (error) {
        console.error("Error saving assignment details:", error);
        if (assignmentErrorMsgDiv) assignmentErrorMsgDiv.textContent = `Error: ${error.message}`;
        alert(`Error saving details: ${error.message}`); // Simple feedback
    } finally {
         // Re-enable button
         if (assignmentSaveBtn) {
             assignmentSaveBtn.disabled = false;
             assignmentSaveBtn.textContent = 'Save Details';
         }
    }
}

// --- Load Initial Data (Modified) ---
/**
 * Fetches and displays the initial dashboard data (students, stats).
 * Now checks if assignment details are present before proceeding.
 */
async function loadInitialDashboardData() {
    console.log("Attempting to load initial dashboard data...");
    // Ensure profile is loaded
    if (!currentTeacherProfile) {
        console.error("Teacher profile data is missing, cannot load dashboard data.");
        if(dashboardContent) dashboardContent.innerHTML = '<p class="text-red-500 text-center p-4">Error: Could not load teacher data. Please re-login.</p>';
        if(loadingIndicator) loadingIndicator.classList.add('hidden');
        if(dashboardContent) dashboardContent.classList.remove('hidden'); // Show error message
        return;
    }

    // *** Gatekeeper: Check if required assignment details are present ***
    if (!currentTeacherProfile.assignedCollegeId || !currentTeacherProfile.assignedDeptId || !currentTeacherProfile.assignedSectionId) {
        console.warn("Assignment details still missing. Dashboard content load deferred.");
        // Ensure modal is visible if details are missing
        checkAndPromptForAssignmentDetails(currentTeacherProfile);
        // Keep loading indicator or show specific message
        if(loadingIndicator) loadingIndicator.classList.remove('hidden'); // Show loading indicator
         loadingIndicator.querySelector('p').textContent = 'Please enter your assignment details...'; // Update loading text
        if(dashboardContent) dashboardContent.classList.add('hidden'); // Hide main content area
        // Hide specific sections that rely on student data
        if(overviewSection) overviewSection.classList.add('hidden');
        if(studentsSection) studentsSection.classList.add('hidden');
        return; // Stop loading process
    } else {
         // Details exist, proceed with loading
         console.log("Assignment details present. Proceeding to load student data and stats.");
         if(loadingIndicator) loadingIndicator.classList.remove('hidden'); // Keep loader visible while fetching
          loadingIndicator.querySelector('p').textContent = 'Loading Dashboard...'; // Reset loading text
         if(dashboardContent) dashboardContent.classList.add('hidden'); // Keep content hidden until fetch completes
    }

    // --- Fetch and Display Data ---
    try {
        // Fetch assigned students (Uses currentTeacherProfile with details)
        console.log("Fetching assigned students...");
        allStudents = await getAssignedStudents(currentTeacherProfile);
        console.log(`Fetched ${allStudents.length} students.`);

        // Display students in the table
        displayStudentList(allStudents, studentListBody, studentListLoading, studentListEmpty);

        // Setup event listeners for the student rows
        setupStudentListEventListeners(handleViewStudentDetails);

        // Calculate and display overview stats
        displayOverallStats(allStudents); // This will also render the chart

        // Initial display: Show overview section (if not already handled by nav setup)
        showSection('overview-section');

    } catch (error) {
        console.error("Error loading dashboard data (students/stats):", error);
        if(dashboardContent) dashboardContent.innerHTML = `<p class="text-red-500 text-center p-4">Error loading dashboard data: ${error.message}. Check console.</p>`;
    } finally {
        // Hide loading indicator and show content area ONLY after successful load or error display
        if(loadingIndicator) loadingIndicator.classList.add('hidden');
        if(dashboardContent) dashboardContent.classList.remove('hidden');
    }
}

// --- Event Handlers (Original - Keep As Is) ---
function handleStudentSearch(event) {
    const searchTerm = event.target.value.toLowerCase();
    const filteredStudents = allStudents.filter(student => {
        const name = student.displayName?.toLowerCase() || '';
        const email = student.email?.toLowerCase() || '';
        return name.includes(searchTerm) || email.includes(searchTerm);
    });
    // Re-render list and re-attach listeners
    displayStudentList(filteredStudents, studentListBody, studentListLoading, studentListEmpty);
    setupStudentListEventListeners(handleViewStudentDetails);
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
        // Fetch session/interview data for the specific student
        const [sessions, interviews] = await Promise.all([
            getStudentSessions(studentId),
            getStudentInterviews(studentId)
        ]);
        console.log(`Fetched ${sessions.length} sessions and ${interviews.length} interviews for ${studentData.displayName}`);
        // Display the fetched details in the modal
        displayStudentDetailsModal(studentData, sessions, interviews);
    } catch (error) {
        console.error("Error fetching student details (sessions/interviews):", error);
        const modalBody = document.getElementById('modal-body');
        if(modalBody) modalBody.innerHTML = `<p class="text-red-500 text-center">Error loading activity details: ${error.message}</p>`;
    }
}


// --- Navigation Logic (Original - Keep As Is) ---
function setupNavigation() {
    const dashboardNav = document.querySelector('#dashboard-view nav');
    if (dashboardNav && !dashboardNav.dataset.listenerAttached) {
         dashboardNav.addEventListener('click', (e) => {
            const link = e.target.closest('.nav-link');
            if (!link) return;
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            if (!targetId) return;

            // Update active link styling
            document.querySelectorAll('#dashboard-view .nav-link').forEach(l => l.classList.remove('active', 'bg-indigo-600'));
            link.classList.add('active', 'bg-indigo-600');

            // Show the target section
            showSection(targetId);
        });
        dashboardNav.dataset.listenerAttached = 'true';
        console.log("Dashboard navigation listener attached.");
    } else if (!dashboardNav) {
         console.error("Dashboard navigation container (nav element) not found.");
    } else {
         console.log("Dashboard navigation listener already attached.");
    }
}

/**
 * Shows a specific dashboard section and hides others.
 * Also handles chart destruction/re-rendering based on section.
 * @param {string} sectionId - The ID of the section to show.
 */
function showSection(sectionId) {
     const sectionToShow = document.getElementById(sectionId);

     if (sectionToShow) {
        // Hide all dashboard sections first
        document.querySelectorAll('#dashboard-view .dashboard-section').forEach(s => {
            s.classList.add('hidden'); // Hide all sections initially
        });
        // Show the target section
        sectionToShow.classList.remove('hidden');
        console.log(`Navigated to section: ${sectionId}`);

        // Handle chart visibility
        if (sectionId !== 'overview-section') {
             destroyCharts(); // Destroy chart if navigating away from overview
        } else {
            // If navigating TO overview, render chart only if data exists and details are present
             if (allStudents.length > 0 && currentTeacherProfile?.assignedCollegeId) { // Added check for details
                displayOverallStats(allStudents); // Renders chart if needed
             } else {
                 // Clear chart area if no data or no details
                 destroyCharts();
                 const chartCanvas = document.getElementById('progressChart');
                 if(chartCanvas) {
                    const ctx = chartCanvas.getContext('2d');
                    ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
                    ctx.textAlign = 'center';
                    ctx.fillStyle = '#6b7280'; // gray-500
                    ctx.fillText(currentTeacherProfile?.assignedCollegeId ? 'No student data available.' : 'Enter assignment details to view stats.', chartCanvas.width / 2, 50);
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