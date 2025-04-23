// js/modules/charts.js

let overviewChartInstance = null; // To keep track of the chart

/**
 * Calculates overview statistics based on student data.
 * @param {Array<object>} students - Array of student profile objects.
 * @param {Array<object>} allSessions - Optional: Array of all session objects for all students (if fetched separately).
 * @param {Array<object>} allInterviews - Optional: Array of all interview objects for all students (if fetched separately).
 * @returns {object} Calculated statistics.
 */
export function calculateStudentStats(students, allSessions = [], allInterviews = []) {
    const stats = {
        totalStudents: students.length,
        studentsOnFree: 0,
        studentsOnPaid: 0,
        totalResumesUsed: 0,
        totalInterviewsUsed: 0,
        avgResumeScore: 0,
        avgInterviewScore: 0,
        // We need session/interview data linked to students for score averages
    };

    let totalResumeScore = 0;
    let resumeScoresCount = 0;
    let totalInterviewScore = 0;
    let interviewScoresCount = 0;

    students.forEach(student => {
        // Plan counts
        if (student.plan === 'free') {
            stats.studentsOnFree++;
        } else if (student.plan && student.plan !== 'free') {
            stats.studentsOnPaid++;
        }

        // Usage counts from student profile
        stats.totalResumesUsed += student.usage?.resumeAnalyses?.used ?? 0;
        stats.totalInterviewsUsed += student.usage?.mockInterviews?.used ?? 0;

        // Note: Calculating average scores requires fetching session/interview data
        // This might be inefficient if done per-student here.
        // It's better if the dashboard fetches all relevant sessions/interviews
        // once and passes them, or if the backend provides aggregated stats.

        // --- Placeholder: If session/interview data is NOT passed ---
        // We can't calculate averages accurately without fetching related data.
        // The current implementation in ui.js fetches per student in the modal.
        // Let's adapt this function to accept the fetched data if available.
    });

     // --- Calculate Averages if session/interview data IS available ---
     // This assumes `allSessions` and `allInterviews` contain data for the *displayed* students
     allSessions.forEach(session => {
        const score = session.results?.match_results?.matchScore;
        if (typeof score === 'number') {
            totalResumeScore += score;
            resumeScoresCount++;
        }
     });
      allInterviews.forEach(interview => {
        const score = interview.analysis?.overallScore;
         if (typeof score === 'number') {
            totalInterviewScore += score;
            interviewScoresCount++;
        }
     });

     if (resumeScoresCount > 0) {
        stats.avgResumeScore = Math.round(totalResumeScore / resumeScoresCount);
     }
      if (interviewScoresCount > 0) {
        stats.avgInterviewScore = Math.round(totalInterviewScore / interviewScoresCount);
     }


    console.log("Calculated Stats:", stats);
    return stats;
}


/**
 * Displays the calculated overview statistics on the dashboard.
 * @param {Array<object>} studentsData - Array of student profile objects.
 */
export function displayOverallStats(studentsData) {
    // TODO: Enhance this to fetch relevant sessions/interviews for score calculation
    // For now, it only uses student profile data
    const stats = calculateStudentStats(studentsData /*, fetchedSessions, fetchedInterviews */); // Pass fetched data when available

    const totalStudentsEl = document.getElementById('stat-total-students');
    const avgResumeScoreEl = document.getElementById('stat-avg-resume-score');
    const avgInterviewScoreEl = document.getElementById('stat-avg-interview-score');

    if (totalStudentsEl) totalStudentsEl.textContent = stats.totalStudents;
    if (avgResumeScoreEl) avgResumeScoreEl.textContent = stats.avgResumeScore > 0 ? `${stats.avgResumeScore}%` : 'N/A';
    if (avgInterviewScoreEl) avgInterviewScoreEl.textContent = stats.avgInterviewScore > 0 ? `${stats.avgInterviewScore}%` : 'N/A';

    // --- Render Overview Chart (Example: Plan Distribution) ---
    const chartCanvas = document.getElementById('progressChart'); // Using the existing canvas ID from history for now
    if (chartCanvas) {
         renderPlanDistributionChart(stats, chartCanvas);
    } else {
        console.warn("Overview chart canvas ('progressChart') not found.");
    }
}

/**
 * Renders a simple pie chart showing plan distribution.
 * @param {object} stats - Calculated statistics object.
 * @param {HTMLCanvasElement} canvasElement - The canvas element to render the chart on.
 */
function renderPlanDistributionChart(stats, canvasElement) {
     if (!canvasElement) return;
     const ctx = canvasElement.getContext('2d');

     // Destroy previous chart instance if it exists
     destroyCharts(); // Use the destroy function

     if (stats.totalStudents === 0) {
         ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
         ctx.textAlign = 'center';
         ctx.fillStyle = '#6b7280'; // gray-500
         ctx.fillText('No student data available for chart.', canvasElement.width / 2, 50);
         return;
     }


     overviewChartInstance = new Chart(ctx, {
         type: 'doughnut', // Or 'pie'
         data: {
             labels: ['Free Plan', 'Paid Plans'],
             datasets: [{
                 label: 'Student Plans',
                 data: [stats.studentsOnFree, stats.studentsOnPaid],
                 backgroundColor: [
                     'rgb(165 180 252)', // indigo-300
                     'rgb(59 130 246)'  // blue-500
                 ],
                 borderColor: [
                     'rgb(255, 255, 255)',
                     'rgb(255, 255, 255)'
                 ],
                 borderWidth: 1,
                 hoverOffset: 4
             }]
         },
         options: {
             responsive: true,
             maintainAspectRatio: false,
             plugins: {
                 legend: {
                     position: 'bottom',
                 },
                 title: {
                     display: true,
                     text: 'Student Plan Distribution'
                 },
                 tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += context.parsed;
                            }
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? Math.round((context.parsed / total) * 100) : 0;
                            label += ` (${percentage}%)`;
                            return label;
                        }
                    }
                 }
             }
         }
     });
}

/**
* Destroys the chart instance if it exists.
*/
export function destroyCharts() {
    if (overviewChartInstance) {
        console.log("Destroying previous overview chart instance.");
        overviewChartInstance.destroy();
        overviewChartInstance = null;
    }
}