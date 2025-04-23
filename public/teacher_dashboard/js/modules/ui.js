// js/modules/ui.js
import { calculateStudentStats } from './charts.js'; // Import stats calculation

/**
 * Displays the list of students in the table.
 * @param {Array<object>} students - Array of student objects.
 * @param {HTMLElement} tableBody - The tbody element to populate.
 * @param {HTMLElement} loadingRow - The loading indicator row.
 * @param {HTMLElement} emptyRow - The empty state indicator row.
 */
export function displayStudentList(students, tableBody, loadingRow, emptyRow) {
    if (!tableBody || !loadingRow || !emptyRow) {
        console.error("Student list table elements not found.");
        return;
    }

    // Clear previous rows (except loading/empty placeholders)
    tableBody.innerHTML = ''; // Clear completely
    tableBody.appendChild(loadingRow); // Re-add placeholders
    tableBody.appendChild(emptyRow);

    loadingRow.classList.add('hidden'); // Hide loading row by default
    emptyRow.classList.add('hidden'); // Hide empty row by default

    if (students.length === 0) {
        emptyRow.classList.remove('hidden'); // Show empty row
        return;
    }

    students.forEach(student => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50'; // Add hover effect

        // Calculate basic stats directly here or pass pre-calculated if available
        const resumeCount = student.usage?.resumeAnalyses?.used ?? 0;
        const interviewCount = student.usage?.mockInterviews?.used ?? 0;
        const section = student.sectionId || 'N/A'; // Assuming sectionId exists

        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm font-medium text-gray-900">${student.displayName || student.email || 'N/A'}</div>
                <div class="text-xs text-gray-500">${student.email || ''}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${section}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">${resumeCount}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">${interviewCount}</td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button class="text-indigo-600 hover:text-indigo-900 view-details-btn" data-student-id="${student.id}">
                    View Details
                </button>
            </td>
        `;
        // Prepend the row so placeholders remain at the bottom until hidden
        tableBody.insertBefore(row, loadingRow);
    });
}

/**
 * Sets up event listeners for the 'View Details' buttons in the student list.
 * Uses event delegation on the table body.
 * @param {function} callback - The function to call when a button is clicked (passes studentId).
 */
export function setupStudentListEventListeners(callback) {
    const tableBody = document.getElementById('student-list-body');
    if (!tableBody) return;

    // Remove existing listener to prevent duplicates if called multiple times
    tableBody.removeEventListener('click', handleTableClick); // Use a named function

    // Add the new listener
    tableBody.addEventListener('click', handleTableClick);

    function handleTableClick(event) {
         // Use closest to find the button, even if the icon inside is clicked
        const button = event.target.closest('.view-details-btn');
        if (button) {
            const studentId = button.getAttribute('data-student-id');
            if (studentId && typeof callback === 'function') {
                callback(studentId);
            }
        }
    }
}


/**
 * Clears the student detail modal and shows a loading message.
 */
export function clearStudentDetailsModal() {
     const modalBody = document.getElementById('modal-body');
     const modalTitle = document.getElementById('modal-student-name');
     if(modalTitle) modalTitle.textContent = 'Student Details';
     if(modalBody) modalBody.innerHTML = '<p class="text-center text-gray-500 py-5"><i class="fas fa-spinner fa-spin mr-2"></i>Loading details...</p>';
}


/**
 * Displays the fetched details (profile, sessions, interviews) for a student in the modal.
 * @param {object} studentData - The student's profile data.
 * @param {Array<object>} sessions - Array of student's session documents.
 * @param {Array<object>} interviews - Array of student's interview documents.
 */
export function displayStudentDetailsModal(studentData, sessions, interviews) {
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-student-name');
    if (!modalBody || !modalTitle) return;

    modalTitle.textContent = `Details for ${studentData.displayName || studentData.email}`;

    // Calculate stats for this student
    const stats = calculateStudentStats([studentData], sessions, interviews); // Pass arrays

    // --- Build Modal Content ---
    let sessionsHtml = '<p class="text-gray-500 text-sm">No resume analyses found.</p>';
    if (sessions.length > 0) {
        sessionsHtml = sessions.map(session => {
            const date = session.start_time ? new Date(session.start_time).toLocaleDateString() : 'N/A';
            const score = session.results?.match_results?.matchScore ?? '--';
            const status = session.status || 'unknown';
            let statusClass = 'bg-gray-400';
            if (status === 'completed') statusClass = 'bg-green-500';
            if (status === 'failed') statusClass = 'bg-red-500';
            if (status === 'processing') statusClass = 'bg-yellow-500';

            return `
                <li class="border-b last:border-b-0 py-2 px-1 flex justify-between items-center text-sm">
                    <span>
                        <span class="inline-block w-3 h-3 rounded-full mr-2 ${statusClass}" title="Status: ${status}"></span>
                        ${date} - Score: <span class="font-semibold">${score}%</span>
                    </span>
                    <button class="text-xs text-indigo-600 hover:underline view-session-report-btn" data-session-id="${session.id}">View Report</button>
                </li>
            `;
        }).join('');
        sessionsHtml = `<ul class="list-none mt-2">${sessionsHtml}</ul>`; // Wrap in UL
    }

    let interviewsHtml = '<p class="text-gray-500 text-sm">No mock interviews found.</p>';
    if (interviews.length > 0) {
        interviewsHtml = interviews.map(interview => {
             const date = interview.start_time ? new Date(interview.start_time).toLocaleDateString() : 'N/A';
             const score = interview.analysis?.overallScore ?? '--';
             const type = interview.interviewType || 'General';
             const status = interview.analysis_status || 'unknown';
             let statusClass = 'bg-gray-400';
             if (status === 'completed') statusClass = 'bg-green-500';
             if (status === 'failed') statusClass = 'bg-red-500';
             if (status === 'processing') statusClass = 'bg-yellow-500';

             return `
                 <li class="border-b last:border-b-0 py-2 px-1 flex justify-between items-center text-sm">
                    <span>
                         <span class="inline-block w-3 h-3 rounded-full mr-2 ${statusClass}" title="Analysis Status: ${status}"></span>
                         ${date} (${type}) - Score: <span class="font-semibold">${score}%</span>
                    </span>
                    <button class="text-xs text-indigo-600 hover:underline view-interview-report-btn" data-interview-id="${interview.id}">View Report</button>
                 </li>
             `;
        }).join('');
        interviewsHtml = `<ul class="list-none mt-2">${interviewsHtml}</ul>`; // Wrap in UL
    }

    modalBody.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div class="bg-gray-50 p-4 rounded-lg border">
                <h4 class="text-lg font-semibold text-gray-800 mb-2 flex items-center"><i class="fas fa-user mr-2"></i>Student Info</h4>
                <p class="text-sm"><strong class="text-gray-600">Name:</strong> ${studentData.displayName || 'N/A'}</p>
                <p class="text-sm"><strong class="text-gray-600">Email:</strong> ${studentData.email || 'N/A'}</p>
                <p class="text-sm"><strong class="text-gray-600">College:</strong> ${studentData.collegeId || 'N/A'}</p>
                <p class="text-sm"><strong class="text-gray-600">Department:</strong> ${studentData.deptId || 'N/A'}</p>
                <p class="text-sm"><strong class="text-gray-600">Section:</strong> ${studentData.sectionId || 'N/A'}</p>
                <p class="text-sm mt-2"><strong class="text-gray-600">Current Plan:</strong> <span class="font-medium capitalize">${studentData.plan || 'free'}</span></p>
            </div>
             <div class="bg-gray-50 p-4 rounded-lg border">
                 <h4 class="text-lg font-semibold text-gray-800 mb-2 flex items-center"><i class="fas fa-chart-pie mr-2"></i>Usage Stats</h4>
                 <p class="text-sm"><strong class="text-gray-600">Resume Analyses:</strong> ${studentData.usage?.resumeAnalyses?.used ?? 0} / ${studentData.usage?.resumeAnalyses?.limit ?? 'N/A'}</p>
                 <p class="text-sm"><strong class="text-gray-600">Mock Interviews:</strong> ${studentData.usage?.mockInterviews?.used ?? 0} / ${studentData.usage?.mockInterviews?.limit ?? 'N/A'}</p>
                 <p class="text-sm mt-3"><strong class="text-gray-600">Avg. Resume Score:</strong> <span class="font-semibold">${stats.avgResumeScore > 0 ? stats.avgResumeScore + '%' : 'N/A'}</span></p>
                 <p class="text-sm"><strong class="text-gray-600">Avg. Interview Score:</strong> <span class="font-semibold">${stats.avgInterviewScore > 0 ? stats.avgInterviewScore + '%' : 'N/A'}</span></p>
            </div>
        </div>

        <div class="mb-6">
            <h4 class="text-lg font-semibold text-gray-800 mb-2 flex items-center"><i class="far fa-file-alt mr-2"></i>Resume Analyses (${sessions.length})</h4>
            <div class="bg-white p-3 rounded-lg border max-h-48 overflow-y-auto">
                ${sessionsHtml}
            </div>
        </div>

         <div>
            <h4 class="text-lg font-semibold text-gray-800 mb-2 flex items-center"><i class="fas fa-microphone-alt mr-2"></i>Mock Interviews (${interviews.length})</h4>
             <div class="bg-white p-3 rounded-lg border max-h-48 overflow-y-auto">
                ${interviewsHtml}
            </div>
        </div>
    `;

    // Add event listeners for the new "View Report" buttons within the modal
    modalBody.querySelectorAll('.view-session-report-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const sessionId = e.target.getAttribute('data-session-id');
            console.log("View Session Report:", sessionId);
            // TODO: Implement function to show detailed session report
            alert(`Placeholder: Show detailed report for session ${sessionId}`);
        });
    });
     modalBody.querySelectorAll('.view-interview-report-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const interviewId = e.target.getAttribute('data-interview-id');
            console.log("View Interview Report:", interviewId);
            // TODO: Implement function to show detailed interview report
             alert(`Placeholder: Show detailed report for interview ${interviewId}`);
        });
    });
}
