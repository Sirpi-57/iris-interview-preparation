// IRIS - Public Job Listings Module

// Global state for public job listings
const publicJobListingsState = {
    jobs: [],
    filteredJobs: [],
    currentCategory: 'all',
    currentSort: 'deadline',
    searchTerm: '',
    currentJobId: null
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Add public job listings tab to navbar
    addJobListingsTab();
    
    // Initialize public job listings when tab is clicked
    const jobListingsTabButton = document.querySelector('.tab-button[data-tab="job-listings-tab"]');
    if (jobListingsTabButton) {
        jobListingsTabButton.addEventListener('click', function() {
            initPublicJobListings();
        });
    }
    
    // Check if we're starting on the job listings tab (from direct link)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab') === 'job-listings') {
        // Select the job listings tab
        const jobListingsTab = document.querySelector('.tab-button[data-tab="job-listings-tab"]');
        if (jobListingsTab) {
            jobListingsTab.click();
        }
    }
});

// Add job listings tab to navbar if it doesn't exist
function addJobListingsTab() {
    const navbarNav = document.getElementById('navbarNav');
    if (!navbarNav) return;
    
    const tabsUl = navbarNav.querySelector('ul.navbar-nav');
    if (!tabsUl) return;
    
    // Check if tab already exists
    if (tabsUl.querySelector('[data-tab="job-listings-tab"]')) return;
    
    // Create and insert tab before the last item (pricing)
    const jobListingsTab = document.createElement('li');
    jobListingsTab.className = 'nav-item';
    jobListingsTab.innerHTML = `
        <a class="nav-link tab-button" data-tab="job-listings-tab" href="#">Job Practice</a>
    `;
    
    // Find pricing tab and insert before it
    const pricingTab = tabsUl.querySelector('[data-tab="pricing-tab"]');
    if (pricingTab && pricingTab.parentNode) {
        tabsUl.insertBefore(jobListingsTab, pricingTab.parentNode);
    } else {
        // If pricing tab not found, just append
        tabsUl.appendChild(jobListingsTab);
    }
}

// Initialize public job listings
function initPublicJobListings() {
    console.log("Initializing public job listings");
    
    // Set up search functionality
    const searchInput = document.getElementById('public-job-search-input');
    const searchButton = document.getElementById('public-search-jobs-btn');
    
    if (searchInput && searchButton) {
        searchInput.addEventListener('input', function() {
            publicJobListingsState.searchTerm = this.value.trim().toLowerCase();
            filterAndSortPublicJobs();
        });
        
        searchButton.addEventListener('click', function() {
            filterAndSortPublicJobs();
        });
        
        // Also trigger search on Enter key
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                filterAndSortPublicJobs();
            }
        });
    }
    
    // Set up category filter dropdown
    const categoryLinks = document.querySelectorAll('#public-category-filter-dropdown .dropdown-item');
    categoryLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Update active class
            categoryLinks.forEach(item => item.classList.remove('active'));
            this.classList.add('active');
            
            // Update state and filter
            publicJobListingsState.currentCategory = this.getAttribute('data-category');
            filterAndSortPublicJobs();
        });
    });
    
    // Set up sort options
    const sortLinks = document.querySelectorAll('#public-sort-options-dropdown .dropdown-item');
    sortLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Update active class
            sortLinks.forEach(item => item.classList.remove('active'));
            this.classList.add('active');
            
            // Update state and sort
            publicJobListingsState.currentSort = this.getAttribute('data-sort');
            filterAndSortPublicJobs();
        });
    });
    
    // Set up job details modal events
    document.getElementById('public-start-practice-btn')?.addEventListener('click', function() {
        handlePublicInterviewStart(publicJobListingsState.currentJobId);
    });
    
    // Load job listings from Firestore
    loadPublicJobListings();
}

// Load job listings from Firestore
function loadPublicJobListings() {
    const container = document.getElementById('public-job-listings-container');
    if (!container) return;
    
    // Show loading state
    container.innerHTML = `
        <div class="col-12 text-center py-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2">Loading job listings...</p>
        </div>
    `;
    
    // Check if Firebase is available
    if (!firebase || !firebase.firestore) {
        container.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    Firebase is not initialized. Cannot load job listings.
                </div>
            </div>
        `;
        return;
    }
    
    // Get current date for filtering expired jobs
    const currentDate = new Date();
    
    // Query Firestore for active job listings (where application deadline hasn't passed)
    firebase.firestore().collection('jobPostings')
        .where('applicationDeadline', '>=', currentDate.toISOString().split('T')[0])
        .orderBy('applicationDeadline', 'asc')
        .get()
        .then(snapshot => {
            publicJobListingsState.jobs = [];
            snapshot.forEach(doc => {
                publicJobListingsState.jobs.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            // Apply initial filtering and sorting
            filterAndSortPublicJobs();
        })
        .catch(error => {
            console.error("Error loading public job listings:", error);
            container.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        Error loading job listings: ${error.message}
                    </div>
                </div>
            `;
        });
}

// Filter and sort jobs based on current state
function filterAndSortPublicJobs() {
    // Start with all jobs
    let filtered = [...publicJobListingsState.jobs];
    
    // Apply category filter if not 'all'
    if (publicJobListingsState.currentCategory !== 'all') {
        filtered = filtered.filter(job => job.category === publicJobListingsState.currentCategory);
    }
    
    // Apply search term filter if any
    if (publicJobListingsState.searchTerm) {
        const searchTerm = publicJobListingsState.searchTerm.toLowerCase();
        filtered = filtered.filter(job => {
            return (
                (job.jobTitle?.toLowerCase().includes(searchTerm)) ||
                (job.companyName?.toLowerCase().includes(searchTerm)) ||
                (job.location?.toLowerCase().includes(searchTerm)) ||
                (job.category?.toLowerCase().includes(searchTerm))
            );
        });
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
        switch (publicJobListingsState.currentSort) {
            case 'deadline':
                return new Date(a.applicationDeadline) - new Date(b.applicationDeadline);
            case 'date':
                return new Date(b.createdAt) - new Date(a.createdAt);
            case 'company':
                return a.companyName.localeCompare(b.companyName);
            default:
                return new Date(a.applicationDeadline) - new Date(b.applicationDeadline);
        }
    });
    
    // Save filtered and sorted jobs
    publicJobListingsState.filteredJobs = filtered;
    
    // Render the jobs
    renderPublicJobListings();
}

// Render job listings to the container
function renderPublicJobListings() {
    const container = document.getElementById('public-job-listings-container');
    if (!container) return;
    
    // If no jobs to show
    if (publicJobListingsState.filteredJobs.length === 0) {
        container.innerHTML = `
            <div class="col-12">
                <div class="alert alert-info">
                    <i class="fas fa-info-circle me-2"></i>
                    No job listings found matching your criteria. Try adjusting your filters.
                </div>
            </div>
        `;
        return;
    }
    
    // Create HTML for job cards
    const jobCardsHTML = publicJobListingsState.filteredJobs.map(job => {
        // Calculate days remaining until deadline
        const deadlineDate = new Date(job.applicationDeadline);
        const now = new Date();
        const daysRemaining = Math.ceil((deadlineDate - now) / (1000 * 60 * 60 * 24));
        
        // Format dates
        const deadlineFormatted = formatDate(job.applicationDeadline);
        const postedFormatted = job.createdAt ? formatDate(job.createdAt.seconds ? new Date(job.createdAt.seconds * 1000) : job.createdAt) : 'N/A';
        
        return `
            <div class="col-md-6 col-lg-4">
                <div class="card h-100 job-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h5 class="card-title mb-0">${job.jobTitle}</h5>
                            <span class="badge bg-secondary">${job.category || 'Uncategorized'}</span>
                        </div>
                        <h6 class="mb-2 text-muted">${job.companyName}</h6>
                        <p class="card-text mb-1"><i class="fas fa-map-marker-alt me-2"></i>${job.location || 'Location not specified'}</p>
                        <p class="card-text mb-1"><i class="fas fa-briefcase me-2"></i>${job.jobType || 'Job type not specified'}</p>
                        <p class="card-text mb-1"><i class="fas fa-graduation-cap me-2"></i>${job.experience || 'Experience not specified'}</p>
                        
                        ${job.salaryRange ? `<p class="card-text mb-1"><i class="fas fa-money-bill-wave me-2"></i>${job.salaryRange}</p>` : ''}
                        
                        <div class="d-flex justify-content-between align-items-center mt-3 mb-2">
                            <small class="text-muted">Posted: ${postedFormatted}</small>
                            <div class="deadline-badge ${daysRemaining <= 3 ? 'text-danger' : ''}">
                                <i class="fas fa-calendar-day me-1"></i>
                                <span>Deadline: ${deadlineFormatted}</span>
                            </div>
                        </div>
                        
                        ${daysRemaining <= 3 ? `
                            <div class="alert alert-warning py-1 px-2 mt-2 mb-0 text-center">
                                <small><i class="fas fa-exclamation-triangle me-1"></i>Closing in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</small>
                            </div>
                        ` : ''}
                    </div>
                    <div class="card-footer bg-transparent">
                        <div class="d-grid gap-2">
                            <button class="btn btn-outline-primary view-public-job-details" data-job-id="${job.id}">
                                <i class="fas fa-eye me-1"></i>View Details
                            </button>
                            <button class="btn btn-primary practice-public-interview" data-job-id="${job.id}">
                                <i class="fas fa-play-circle me-1"></i>Practice Interview
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Update container
    container.innerHTML = jobCardsHTML;
    
    // Add event listeners to buttons
    container.querySelectorAll('.view-public-job-details').forEach(btn => {
        btn.addEventListener('click', function() {
            const jobId = this.getAttribute('data-job-id');
            showPublicJobDetails(jobId);
        });
    });
    
    container.querySelectorAll('.practice-public-interview').forEach(btn => {
        btn.addEventListener('click', function() {
            const jobId = this.getAttribute('data-job-id');
            handlePublicInterviewStart(jobId);
        });
    });
}

// Show job details in modal
function showPublicJobDetails(jobId) {
    // Set current job ID
    publicJobListingsState.currentJobId = jobId;
    
    // Find job in state
    const job = publicJobListingsState.jobs.find(j => j.id === jobId);
    if (!job) {
        showMessage('Job not found', 'danger');
        return;
    }
    
    // Populate modal
    const modalTitle = document.getElementById('publicJobDetailsModalLabel');
    const modalContent = document.getElementById('public-job-details-content');
    
    modalTitle.textContent = `${job.jobTitle} - ${job.companyName}`;
    
    // Format dates
    const deadlineFormatted = formatDate(job.applicationDeadline);
    const postedFormatted = job.createdAt ? formatDate(job.createdAt.seconds ? new Date(job.createdAt.seconds * 1000) : job.createdAt) : 'N/A';
    
    // Format skills lists
    const mustHaveSkillsHtml = job.mustHaveSkills?.length 
        ? `<ul>${job.mustHaveSkills.map(skill => `<li>${skill}</li>`).join('')}</ul>`
        : '<em>None specified</em>';
        
    const niceToHaveSkillsHtml = job.niceToHaveSkills?.length 
        ? `<ul>${job.niceToHaveSkills.map(skill => `<li>${skill}</li>`).join('')}</ul>`
        : '<em>None specified</em>';
    
    modalContent.innerHTML = `
        <div class="job-details">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                    <span class="badge bg-secondary">${job.category || 'Uncategorized'}</span>
                    <span class="badge bg-primary">${job.jobType || 'Not specified'}</span>
                    <span class="badge bg-info text-dark">${job.experience || 'Not specified'}</span>
                </div>
            </div>
            
            <div class="row mb-4">
                <div class="col-md-6">
                    <p><strong><i class="fas fa-map-marker-alt me-2"></i>Location:</strong> ${job.location || 'Not specified'}</p>
                    ${job.salaryRange ? `<p><strong><i class="fas fa-money-bill-wave me-2"></i>Salary Range:</strong> ${job.salaryRange}</p>` : ''}
                </div>
                <div class="col-md-6">
                    <p><strong><i class="fas fa-calendar-alt me-2"></i>Posted Date:</strong> ${postedFormatted}</p>
                    <p><strong><i class="fas fa-hourglass-end me-2"></i>Application Deadline:</strong> ${deadlineFormatted}</p>
                </div>
            </div>
            
            <div class="row mb-3">
                <div class="col-md-6">
                    <h5><i class="fas fa-check-circle me-2"></i>Must-Have Skills</h5>
                    ${mustHaveSkillsHtml}
                </div>
                <div class="col-md-6">
                    <h5><i class="fas fa-plus-circle me-2"></i>Nice-to-Have Skills</h5>
                    ${niceToHaveSkillsHtml}
                </div>
            </div>
            
            <div class="mb-4 pb-3 border-bottom">
                <h5><i class="fas fa-align-left me-2"></i>Job Description</h5>
                <div>${job.jobDescription.replace(/\n/g, '<br>')}</div>
            </div>
            
            ${job.responsibilities ? `
                <div class="mb-4 pb-3 border-bottom">
                    <h5><i class="fas fa-tasks me-2"></i>Key Responsibilities</h5>
                    <div>${job.responsibilities.replace(/\n/g, '<br>')}</div>
                </div>
            ` : ''}
            
            ${job.education ? `
                <div class="mb-4 pb-3 border-bottom">
                    <h5><i class="fas fa-graduation-cap me-2"></i>Education Requirements</h5>
                    <p>${job.education}</p>
                </div>
            ` : ''}
            
            <div class="alert alert-info">
                <i class="fas fa-info-circle me-2"></i>
                <strong>Ready to practice?</strong> Click "Practice Interview" to start a tailored mock interview for this position.
            </div>
        </div>
    `;
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('public-job-details-modal'));
    modal.show();
}

// Handle Practice Interview button from public view
function handlePublicInterviewStart(jobId) {
    console.log(`Starting interview for job ID: ${jobId}`);
    
    // Check if user is authenticated
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        console.log("User not logged in, showing sign in modal");
        
        // Close the job details modal if open
        const detailsModal = bootstrap.Modal.getInstance(document.getElementById('public-job-details-modal'));
        if (detailsModal) {
            detailsModal.hide();
        }
        
        // Store job ID in localStorage to retrieve after login
        localStorage.setItem('pendingJobInterviewId', jobId);
        
        // Show auth modal
        if (typeof irisAuth !== 'undefined' && typeof irisAuth.showSignInModal === 'function') {
            irisAuth.showSignInModal();
        } else {
            // Fallback to basic modal
            const authModal = bootstrap.Modal.getInstance(document.getElementById('auth-modal'));
            if (authModal) {
                authModal.show();
            }
        }
        
        // Add a login success listener that redirects to interview setup
        window.addEventListener('authSuccess', function handleAuthSuccess() {
            // This will fire when authentication is successful
            // Remove the listener to prevent multiple calls
            window.removeEventListener('authSuccess', handleAuthSuccess);
            
            // Get the stored job ID
            const pendingJobId = localStorage.getItem('pendingJobInterviewId');
            if (pendingJobId) {
                localStorage.removeItem('pendingJobInterviewId');
                
                // Redirect to main app with job ID
                initiateJobSpecificFlow(pendingJobId);
            }
        }, { once: true });
        
        return;
    }
    
    // User is already logged in, proceed to interview setup
    initiateJobSpecificFlow(jobId);
}

// Function to initiate job-specific interview flow
function initiateJobSpecificFlow(jobId) {
    console.log(`Initiating job-specific flow for job ID: ${jobId}`);
    
    // Store route ID and job ID in localStorage
    localStorage.setItem('routeId', 'jobSpecific');
    localStorage.setItem('currentJobId', jobId);
    
    // Check if already in main app view
    const appViewVisible = document.getElementById('app-view').style.display !== 'none';
    
    if (appViewVisible) {
        // Already in app view, just load job-specific interface
        loadJobSpecificInterface();
    } else {
        // Switch to app view first
        document.getElementById('public-view').style.display = 'none';
        document.getElementById('app-view').style.display = 'flex';
        
        // Load job-specific interface
        loadJobSpecificInterface();
    }
}

// Helper function to format dates
function formatDate(dateString) {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid date';
    
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Helper function to show messages (reusing from app.js)
function showMessage(message, type = 'info') {
    const errorContainer = document.getElementById('error-messages');
    if (!errorContainer) {
        console.warn('Error messages container not found');
        alert(message); // Fallback to alert
        return;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `alert alert-${type} alert-dismissible fade show`;
    messageDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    errorContainer.appendChild(messageDiv);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        messageDiv.classList.remove('show');
        setTimeout(() => messageDiv.remove(), 500);
    }, 5000);
}