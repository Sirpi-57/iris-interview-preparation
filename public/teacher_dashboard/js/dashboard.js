// js/dashboard.js
import { checkAuthState, handleSignOut, getTeacherData } from './modules/auth.js';
import { getAssignedStudents, getStudentSessions, getStudentInterviews } from './modules/firestoreService.js';
import { displayStudentList, displayStudentDetailsModal, setupStudentListEventListeners, clearStudentDetailsModal } from './modules/ui.js';
import { displayOverallStats, destroyCharts } from './modules/charts.js'; // Assuming charts.js exists

const logoutButton = document.getElementById('logout-button');
const studentListBody = document.getElementById('student-list-body');
const studentListLoading = document.getElementById('student-list-loading');
const studentListEmpty = document.getElementById('student-list-empty');
const studentSearchInput = document.getElementById('student-search');
const overviewSection = document.getElementById('overview-section');
const studentsSection = document.getElementById('students-section');
const navLinks = document.querySelectorAll('.nav-link');
const closeModalButton = document.getElementById('close-modal-button');
const studentDetailModal = document.getElementById('student-detail-modal');

let allStudents = []; // Store all fetched students for filtering
let currentTeacherProfile = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Dashboard DOM loaded");
    // Check authentication state - this handles redirects and initial loading
    checkAuthState('dashboardPage');

    // Add event listeners
    if (logoutButton) {
        logoutButton.addEventListener('click', handleSignOut);
    } else {
        console.error("Logout button not found");
    }

    if(studentSearchInput) {
        studentSearchInput.addEventListener('input', handleStudentSearch);
    }

    // Setup navigation between dashboard sections
    setupNavigation();

    // Setup modal close button
    if (closeModalButton && studentDetailModal) {
        closeModalButton.addEventListener('click', () => {
            studentDetailModal.classList.add('hidden');
            clearStudentDetailsModal(); // Clear content when closing
        });
        // Optional: Close modal if clicking outside
        studentDetailModal.addEventListener('click', (event) => {
            if (event.target === studentDetailModal) {
                 studentDetailModal.classList.add('hidden');
                 clearStudentDetailsModal();
            }
        });
    }

});

// --- Global Function to Load Data (Called by auth.js after verification) ---
window.loadDashboardData = async (teacherData) => {
    console.log("loadDashboardData called");
    currentTeacherProfile = teacherData; // Store teacher profile globally for this session

    if (!currentTeacherProfile) {
        console.error("Teacher profile data is missing, cannot load dashboard data.");
        // Show error message in UI
        document.getElementById('dashboard-content').innerHTML = '<p class="text-red-500 text-center p-4">Error: Could not load teacher data. Please sign out and try again.</p>';
        document.getElementById('loading-indicator').classList.add('hidden'); // Hide loader
        document.getElementById('dashboard-content').classList.remove('hidden'); // Show content area (with error)
        return;
    }

    try {
        // Fetch assigned students based on teacher's profile
        allStudents = await getAssignedStudents(currentTeacherProfile);

        // Display students in the table
        displayStudentList(allStudents, studentListBody, studentListLoading, studentListEmpty);

        // Setup event listeners for the newly added student rows (view details buttons)
        setupStudentListEventListeners(handleViewStudentDetails);

        // Calculate and display overview stats
        displayOverallStats(allStudents);

        // Initial display: Show overview
        showSection('overview-section');

    } catch (error) {
        console.error("Error loading dashboard data:", error);
        // Display error in the main content area
         document.getElementById('dashboard-content').innerHTML = `<p class="text-red-500 text-center p-4">Error loading dashboard data: ${error.message}. Check console for details.</p>`;
    } finally {
        // Ensure loading indicator is hidden and content is shown (even on error)
         document.getElementById('loading-indicator').classList.add('hidden');
         document.getElementById('dashboard-content').classList.remove('hidden');
    }
};

// --- Event Handlers ---

function handleStudentSearch(event) {
    const searchTerm = event.target.value.toLowerCase();
    const filteredStudents = allStudents.filter(student => {
        const name = student.displayName?.toLowerCase() || '';
        const email = student.email?.toLowerCase() || '';
        return name.includes(searchTerm) || email.includes(searchTerm);
    });
    displayStudentList(filteredStudents, studentListBody, studentListLoading, studentListEmpty);
    // Re-attach listeners after filtering might be needed if rows are completely replaced
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

    // Show modal and loading state
    if (studentDetailModal) studentDetailModal.classList.remove('hidden');
    clearStudentDetailsModal(); // Clear previous content and show loader

    try {
        // Fetch sessions and interviews in parallel
        const [sessions, interviews] = await Promise.all([
            getStudentSessions(studentId),
            getStudentInterviews(studentId)
        ]);

        console.log(`Fetched ${sessions.length} sessions and ${interviews.length} interviews for ${studentData.displayName}`);

        // Display details in the modal
        displayStudentDetailsModal(studentData, sessions, interviews);

    } catch (error) {
        console.error("Error fetching student details:", error);
        const modalBody = document.getElementById('modal-body');
        if(modalBody) modalBody.innerHTML = `<p class="text-red-500 text-center">Error loading details: ${error.message}</p>`;
    }
}

// --- Navigation Logic ---
function setupNavigation() {
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');

            // Remove active class from all links and sections
            navLinks.forEach(l => l.classList.remove('active', 'bg-indigo-600'));
            document.querySelectorAll('.dashboard-section').forEach(s => s.classList.add('hidden')); // Use hidden class

            // Add active class to the clicked link and target section
            link.classList.add('active', 'bg-indigo-600');
            showSection(targetId);
        });
    });
}

function showSection(sectionId) {
     const section = document.getElementById(sectionId);
     if (section) {
        // Hide all sections first
        document.querySelectorAll('.dashboard-section').forEach(s => s.classList.add('hidden'));
        // Show the target section
        section.classList.remove('hidden');
        console.log(`Navigated to section: ${sectionId}`);

        // Destroy charts if navigating away from overview (or relevant section)
        if (sectionId !== 'overview-section') {
             destroyCharts(); // Make sure charts are destroyed to prevent issues
        }
        // Re-render charts if navigating TO overview
        if (sectionId === 'overview-section' && allStudents.length > 0) {
            displayOverallStats(allStudents); // Re-display stats which includes chart rendering
        }

     } else {
        console.warn(`Navigation target section not found: ${sectionId}`);
     }
}
