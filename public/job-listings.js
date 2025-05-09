// job-listings.js - Handles Job Listings functionality for IRIS public website

// --- DOM Elements ---
const jobListingsContainer = document.getElementById('public-job-listings-container');
const categoryFilterDropdown = document.getElementById('public-category-filter-dropdown');
const sortOptionsDropdown = document.getElementById('public-sort-options-dropdown');
const jobSearchInput = document.getElementById('public-job-search-input');
const searchJobsBtn = document.getElementById('public-search-jobs-btn');
const jobDetailsModal = new bootstrap.Modal(document.getElementById('public-job-details-modal'));
const jobDetailsContent = document.getElementById('public-job-details-content');
const startPracticeBtn = document.getElementById('public-start-practice-btn');

// --- State Variables ---
let allJobs = [];
let currentCategory = 'all';
let currentSortOption = 'deadline';
let currentSearchQuery = '';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadJobListings();
    
    // Event Listeners
    if (categoryFilterDropdown) {
        categoryFilterDropdown.addEventListener('click', handleCategoryFilter);
    }
    
    if (sortOptionsDropdown) {
        sortOptionsDropdown.addEventListener('click', handleSortOption);
    }
    
    if (searchJobsBtn) {
        searchJobsBtn.addEventListener('click', handleSearch);
    }
    
    if (jobSearchInput) {
        jobSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
    
    if (startPracticeBtn) {
        startPracticeBtn.addEventListener('click', startPracticeInterview);
    }
});

// --- Functions ---

/**
 * Loads job listings from Firestore
 */
async function loadJobListings() {
    if (!jobListingsContainer) return;
    
    try {
        setLoadingState(true);
        
        // Query Firestore for active job listings
        const snapshot = await firebase.firestore()
            .collection('jobPostings')
            .where('status', '==', 'active')
            .orderBy('postedDate', 'desc')
            .limit(50)
            .get();
            
        if (snapshot.empty) {
            showNoJobsMessage();
            return;
        }
        
        // Process job data
        allJobs = [];
        snapshot.forEach(doc => {
            const job = doc.data();
            job.id = doc.id;
            
            // Format dates for display
            if (job.postedDate) {
                job.postedDateFormatted = formatFirestoreDate(job.postedDate);
                job.postedDateRaw = job.postedDate.toDate();
            }
            
            if (job.expiryDate) {
                job.expiryDateFormatted = formatFirestoreDate(job.expiryDate);
                job.expiryDateRaw = job.expiryDate.toDate();
            }
            
            allJobs.push(job);
        });
        
        // Apply initial filtering and sorting
        filterAndDisplayJobs();
        
    } catch (error) {
        console.error("Error loading job listings:", error);
        jobListingsContainer.innerHTML = `
            <div class="col-12 text-center">
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    Error loading job listings. Please try again later.
                </div>
            </div>
        `;
    } finally {
        setLoadingState(false);
    }
}

/**
 * Filters and displays jobs based on current filters and sort options
 */
function filterAndDisplayJobs() {
    if (!jobListingsContainer || !allJobs) return;
    
    // Apply category filter
    let filteredJobs = allJobs;
    if (currentCategory !== 'all') {
        filteredJobs = allJobs.filter(job => {
            return job.category && job.category.toLowerCase() === currentCategory.toLowerCase();
        });
    }
    
    // Apply search query if exists
    if (currentSearchQuery) {
        const query = currentSearchQuery.toLowerCase();
        filteredJobs = filteredJobs.filter(job => {
            return (
                (job.title && job.title.toLowerCase().includes(query)) ||
                (job.companyName && job.companyName.toLowerCase().includes(query)) ||
                (job.description && job.description.toLowerCase().includes(query)) ||
                (job.location && job.location.toLowerCase().includes(query)) ||
                (job.category && job.category.toLowerCase().includes(query))
            );
        });
    }
    
    // Apply sorting
    if (currentSortOption === 'deadline') {
        filteredJobs.sort((a, b) => {
            if (!a.expiryDateRaw) return 1;
            if (!b.expiryDateRaw) return -1;
            return a.expiryDateRaw - b.expiryDateRaw;
        });
    } else if (currentSortOption === 'date') {
        filteredJobs.sort((a, b) => {
            if (!a.postedDateRaw) return 1;
            if (!b.postedDateRaw) return -1;
            return b.postedDateRaw - a.postedDateRaw;
        });
    } else if (currentSortOption === 'company') {
        filteredJobs.sort((a, b) => {
            if (!a.companyName) return 1;
            if (!b.companyName) return -1;
            return a.companyName.localeCompare(b.companyName);
        });
    }
    
    // Display filtered jobs
    displayJobs(filteredJobs);
}

/**
 * Renders job listings to the DOM
 * @param {Array} jobs - Array of job objects to display
 */
function displayJobs(jobs) {
    if (!jobListingsContainer) return;
    
    if (!jobs.length) {
        showNoJobsMessage();
        return;
    }
    
    let jobsHTML = '';
    
    jobs.forEach(job => {
        const daysAgo = job.postedDateRaw ? Math.floor((new Date() - job.postedDateRaw) / (1000 * 60 * 60 * 24)) : 0;
        const daysUntilExpiry = job.expiryDateRaw ? Math.floor((job.expiryDateRaw - new Date()) / (1000 * 60 * 60 * 24)) : null;
        
        jobsHTML += `
            <div class="col-md-6 col-lg-4">
                <div class="card h-100 shadow-sm">
                    <div class="card-body">
                        <div class="d-flex align-items-center mb-3">
                            ${job.companyLogoUrl ? 
                                `<img src="${job.companyLogoUrl}" alt="${job.companyName}" class="me-3" style="height: 40px; width: auto; max-width: 100px; object-fit: contain;">` : 
                                `<div class="bg-light rounded-circle d-flex align-items-center justify-content-center me-3" style="width: 40px; height: 40px;">
                                    <i class="fas fa-building text-secondary"></i>
                                </div>`
                            }
                            <div>
                                <h5 class="card-title mb-0">${job.title || 'Untitled Position'}</h5>
                                <p class="text-muted mb-0">${job.companyName || 'Unknown Company'}</p>
                            </div>
                        </div>
                        
                        <div class="mb-3">
                            <p class="card-text mb-2">
                                <i class="fas fa-map-marker-alt text-secondary me-2"></i> ${job.location || 'Location not specified'}
                            </p>
                            <p class="card-text mb-2">
                                <i class="fas fa-briefcase text-secondary me-2"></i> ${job.experienceLevel || 'Experience not specified'}
                            </p>
                            <p class="card-text mb-0">
                                <i class="fas fa-tag text-secondary me-2"></i> ${job.category || 'Uncategorized'}
                                ${job.subCategory ? ` / ${job.subCategory}` : ''}
                            </p>
                        </div>
                        
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="badge bg-light text-dark">
                                <i class="far fa-calendar-alt me-1"></i> Posted ${daysAgo === 0 ? 'today' : daysAgo + ' days ago'}
                            </span>
                            ${daysUntilExpiry !== null ? 
                                `<span class="badge ${daysUntilExpiry < 3 ? 'bg-danger' : daysUntilExpiry < 7 ? 'bg-warning text-dark' : 'bg-success'}">
                                    ${daysUntilExpiry <= 0 ? 'Closing today' : `${daysUntilExpiry} days left`}
                                </span>` : 
                                ''}
                        </div>
                        
                        <div class="mt-3 d-grid gap-2">
                            <button class="btn btn-outline-primary view-job-details" data-job-id="${job.id}">
                                <i class="fas fa-info-circle me-1"></i> Know More
                            </button>
                            <button class="btn btn-primary take-mock-btn" data-job-id="${job.id}">
                                <i class="fas fa-play-circle me-1"></i> Take Mock
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    jobListingsContainer.innerHTML = jobsHTML;
    
    // Add event listeners to job cards
    document.querySelectorAll('.view-job-details').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const jobId = e.currentTarget.getAttribute('data-job-id');
            showJobDetails(jobId);
        });
    });
    
    document.querySelectorAll('.take-mock-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const jobId = e.currentTarget.getAttribute('data-job-id');
            takeMockInterview(jobId);
        });
    });
}

/**
 * Shows a message when no jobs are found
 */
function showNoJobsMessage() {
    if (!jobListingsContainer) return;
    
    jobListingsContainer.innerHTML = `
        <div class="col-12 text-center py-4">
            <div class="alert alert-info">
                <i class="fas fa-info-circle me-2"></i>
                No job listings found matching your criteria.
            </div>
            <button class="btn btn-outline-primary mt-3" id="reset-filters-btn">
                <i class="fas fa-sync me-1"></i> Reset Filters
            </button>
        </div>
    `;
    
    document.getElementById('reset-filters-btn')?.addEventListener('click', resetFilters);
}

/**
 * Resets all filters and search criteria
 */
function resetFilters() {
    currentCategory = 'all';
    currentSortOption = 'deadline';
    currentSearchQuery = '';
    
    // Reset UI elements
    if (jobSearchInput) jobSearchInput.value = '';
    
    // Update active state in dropdowns
    if (categoryFilterDropdown) {
        categoryFilterDropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-category') === 'all');
        });
    }
    
    if (sortOptionsDropdown) {
        sortOptionsDropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-sort') === 'deadline');
        });
    }
    
    // Reapply filters and display
    filterAndDisplayJobs();
}

/**
 * Handles category filter changes
 * @param {Event} e - Click event
 */
function handleCategoryFilter(e) {
    e.preventDefault();
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    
    const category = item.getAttribute('data-category');
    if (!category || category === currentCategory) return;
    
    // Update active state in dropdown
    categoryFilterDropdown.querySelectorAll('.dropdown-item').forEach(el => {
        el.classList.toggle('active', el === item);
    });
    
    currentCategory = category;
    filterAndDisplayJobs();
}

/**
 * Handles sort option changes
 * @param {Event} e - Click event
 */
function handleSortOption(e) {
    e.preventDefault();
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    
    const sortOption = item.getAttribute('data-sort');
    if (!sortOption || sortOption === currentSortOption) return;
    
    // Update active state in dropdown
    sortOptionsDropdown.querySelectorAll('.dropdown-item').forEach(el => {
        el.classList.toggle('active', el === item);
    });
    
    currentSortOption = sortOption;
    filterAndDisplayJobs();
}

/**
 * Handles search input
 */
function handleSearch() {
    if (!jobSearchInput) return;
    
    const query = jobSearchInput.value.trim();
    if (query === currentSearchQuery) return;
    
    currentSearchQuery = query;
    filterAndDisplayJobs();
}

/**
 * Shows job details in a modal
 * @param {string} jobId - ID of the job to display
 */
async function showJobDetails(jobId) {
    if (!jobDetailsModal || !jobDetailsContent) return;
    
    // Show loading state
    jobDetailsContent.innerHTML = `
        <div class="text-center py-3">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2">Loading job details...</p>
        </div>
    `;
    jobDetailsModal.show();
    
    try {
        // Find job in the existing array first
        let job = allJobs.find(j => j.id === jobId);
        
        // If not found, fetch from Firestore
        if (!job) {
            const doc = await firebase.firestore().collection('jobPostings').doc(jobId).get();
            if (!doc.exists) {
                throw new Error('Job not found');
            }
            job = doc.data();
            job.id = doc.id;
            
            // Format dates
            if (job.postedDate) {
                job.postedDateFormatted = formatFirestoreDate(job.postedDate);
            }
            
            if (job.expiryDate) {
                job.expiryDateFormatted = formatFirestoreDate(job.expiryDate);
            }
        }
        
        // Store current job ID for practice button
        startPracticeBtn.setAttribute('data-job-id', jobId);
        
        // Render job details
        jobDetailsContent.innerHTML = `
            <div class="job-details">
                <div class="d-flex align-items-center mb-4">
                    ${job.companyLogoUrl ? 
                        `<img src="${job.companyLogoUrl}" alt="${job.companyName}" class="me-3" style="height: 60px; width: auto; max-width: 150px; object-fit: contain;">` : 
                        `<div class="bg-light rounded-circle d-flex align-items-center justify-content-center me-3" style="width: 60px; height: 60px;">
                            <i class="fas fa-building text-secondary fa-2x"></i>
                        </div>`
                    }
                    <div>
                        <h4 class="mb-1">${job.title || 'Untitled Position'}</h4>
                        <p class="text-muted mb-0">${job.companyName || 'Unknown Company'}</p>
                    </div>
                </div>
                
                <div class="row mb-4">
                    <div class="col-md-6">
                        <div class="mb-3">
                            <h6><i class="fas fa-map-marker-alt text-primary me-2"></i> Location:</h6>
                            <p>${job.location || 'Not specified'}</p>
                        </div>
                        
                        <div class="mb-3">
                            <h6><i class="fas fa-briefcase text-primary me-2"></i> Experience:</h6>
                            <p>${job.experienceLevel || 'Not specified'}</p>
                        </div>
                        
                        <div class="mb-3">
                            <h6><i class="fas fa-tag text-primary me-2"></i> Category:</h6>
                            <p>${job.category || 'Not specified'}${job.subCategory ? ` / ${job.subCategory}` : ''}</p>
                        </div>
                    </div>
                    
                    <div class="col-md-6">
                        <div class="mb-3">
                            <h6><i class="fas fa-calendar-alt text-primary me-2"></i> Posted:</h6>
                            <p>${job.postedDateFormatted || 'Not specified'}</p>
                        </div>
                        
                        <div class="mb-3">
                            <h6><i class="fas fa-calendar-times text-primary me-2"></i> Deadline:</h6>
                            <p>${job.expiryDateFormatted || 'Not specified'}</p>
                        </div>
                        
                        ${job.salaryRange ? `
                        <div class="mb-3">
                            <h6><i class="fas fa-money-bill-wave text-primary me-2"></i> Salary Range:</h6>
                            <p>${job.salaryRange}</p>
                        </div>
                        ` : ''}
                        
                        ${job.relocation ? `
                        <div class="mb-3">
                            <h6><i class="fas fa-plane-departure text-primary me-2"></i> Relocation:</h6>
                            <p>Relocation assistance available</p>
                        </div>
                        ` : ''}
                    </div>
                </div>
                
                <div class="mb-4">
                    <h5><i class="fas fa-laptop-code text-primary me-2"></i> Tech Stack:</h5>
                    <div>
                        ${job.techStacks && job.techStacks.length ? 
                            job.techStacks.map(tech => `<span class="badge bg-light text-dark border me-2 mb-2 py-2 px-3">${tech}</span>`).join('') : 
                            '<p>No specific tech stack mentioned</p>'
                        }
                    </div>
                </div>
                
                <div class="mb-4">
                    <h5><i class="fas fa-align-left text-primary me-2"></i> Job Description:</h5>
                    <div class="job-description">
                        ${job.description || 'No description available'}
                    </div>
                </div>
                
                <div class="mb-4">
                    <h5><i class="fas fa-clipboard-list text-primary me-2"></i> Requirements:</h5>
                    <div class="job-requirements">
                        ${job.requirements || 'No specific requirements mentioned'}
                    </div>
                </div>
                
                ${job.sourceLink ? `
                <div class="mb-4">
                    <h5><i class="fas fa-external-link-alt text-primary me-2"></i> Source:</h5>
                    <a href="${job.sourceLink}" target="_blank" rel="noopener noreferrer">View original job posting</a>
                </div>
                ` : ''}
                
                ${job.customFields && Object.keys(job.customFields).length > 0 ? `
                <div class="mb-4">
                    <h5><i class="fas fa-info-circle text-primary me-2"></i> Additional Information:</h5>
                    <dl class="row">
                        ${Object.entries(job.customFields).map(([key, value]) => `
                            <dt class="col-sm-3">${key}:</dt>
                            <dd class="col-sm-9">${value}</dd>
                        `).join('')}
                    </dl>
                </div>
                ` : ''}
            </div>
        `;
        
    } catch (error) {
        console.error("Error loading job details:", error);
        jobDetailsContent.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle me-2"></i>
                Error loading job details. Please try again later.
            </div>
        `;
    }
}

/**
 * Initiates mock interview for a job
 * @param {string} jobId - ID of the job to practice for
 */
function takeMockInterview(jobId) {
    // First check if user is logged in
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        // Store the job ID for later use after authentication
        // Use the function exposed by irisAuth
        if (window.irisAuth && typeof window.irisAuth.setPendingJobInterview === 'function') {
            window.irisAuth.setPendingJobInterview(jobId);
        } else {
            console.warn("irisAuth.setPendingJobInterview not available, falling back to global variable");
            pendingJobInterviewAfterAuth = jobId;
        }
        
        // Show login modal
        if (typeof showAuthModal === 'function') {
            showAuthModal('signin');
        } else if (window.irisAuth && typeof window.irisAuth.showSignInModal === 'function') {
            window.irisAuth.showSignInModal();
        } else {
            alert('Please sign in to take a mock interview.');
        }
        return;
    }
    
    // Check if email needs verification
    if (window.irisAuth && typeof window.irisAuth.isEmailVerified === 'function') {
        const isVerified = window.irisAuth.isEmailVerified();
        if (!isVerified) {
            // Show email verification modal
            if (typeof window.irisAuth.showEmailVerificationModal === 'function') {
                window.irisAuth.showEmailVerificationModal(currentUser.email);
            }
            showMessage('Please verify your email before proceeding with the mock interview', 'info');
            return;
        }
    }
    
    // Check if user can use mock interviews feature
    if (window.irisAuth && typeof window.irisAuth.canUseFeature === 'function') {
        if (!window.irisAuth.canUseFeature('mockInterviews')) {
            showLimitReachedModal('mockInterviews', {
                used: window.irisAuth.getUserProfile()?.usage?.mockInterviews?.used || 0,
                limit: window.irisAuth.getUserProfile()?.usage?.mockInterviews?.limit || 0,
                plan: window.irisAuth.getUserProfile()?.plan || 'free'
            });
            return;
        }
    }
    
    // User is already logged in with verified email and has available interviews
    startJobSpecificResumeUpload(jobId);
}

// Function to show a message (similar to your existing showErrorMessage function)
function showMessage(message, type = 'info', duration = 5000) {
    // Create toast or use existing error container
    const errorContainer = document.getElementById('error-messages');
    if (errorContainer) {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        errorContainer.appendChild(alertDiv);
        
        // Auto-dismiss after duration
        setTimeout(() => {
            alertDiv.classList.remove('show');
            setTimeout(() => alertDiv.remove(), 500);
        }, duration);
    } else {
        // Fallback to console
        console.log(message);
    }
}

/**
 * Handles the start of the mock process from the job details modal
 */
function startPracticeInterview() {
    const jobId = startPracticeBtn.getAttribute('data-job-id');
    if (!jobId) {
        console.error("No job ID found for practice button");
        return;
    }
    
    // Hide the modal
    jobDetailsModal.hide();
    
    // Start the mock interview process
    takeMockInterview(jobId);
}

/**
 * Prompt user to upload resume for mock interview
 * @param {Object} job - The job object for the mock interview
 */
function startResumeUpload(job) {
    // Create a modal for resume upload if it doesn't exist
    if (!document.getElementById('resume-upload-modal')) {
        const modalHTML = `
            <div class="modal fade" id="resume-upload-modal" tabindex="-1" aria-labelledby="resumeUploadModalLabel" aria-hidden="true">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="resumeUploadModalLabel">Upload Your Resume</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p class="mb-3">Upload your resume to tailor the mock interview for <strong>${job.title}</strong> at <strong>${job.companyName}</strong>.</p>
                            
                            <form id="job-resume-upload-form">
                                <div class="mb-3">
                                    <label for="job-resume-file" class="form-label">Resume (PDF format)</label>
                                    <input type="file" class="form-control" id="job-resume-file" accept=".pdf" required>
                                </div>
                                <div class="d-grid">
                                    <button type="submit" class="btn btn-primary" id="submit-resume-btn">
                                        <i class="fas fa-upload me-1"></i> Upload & Continue
                                    </button>
                                </div>
                            </form>
                            
                            <div id="job-resume-upload-progress" class="mt-3" style="display: none;">
                                <div class="progress mb-2">
                                    <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div>
                                </div>
                                <p class="text-center" id="job-resume-upload-status">Preparing...</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add event listener for form submission
        document.getElementById('job-resume-upload-form').addEventListener('submit', (e) => {
            e.preventDefault();
            processResumeUpload(job);
        });
    }
    
    // Update modal title with job info if it already exists
    const modalTitle = document.getElementById('resumeUploadModalLabel');
    if (modalTitle) {
        modalTitle.innerHTML = `Upload Resume for ${job.title} Interview`;
    }
    
    // Show the modal
    const resumeUploadModal = new bootstrap.Modal(document.getElementById('resume-upload-modal'));
    resumeUploadModal.show();
}

/**
 * Process resume upload and initiates mock interview
 * @param {Object} job - The job object for the mock interview
 */
async function processResumeUpload(job) {
    const resumeFile = document.getElementById('job-resume-file').files[0];
    if (!resumeFile) {
        alert('Please select a resume file.');
        return;
    }
    
    // Show progress UI
    const progressContainer = document.getElementById('job-resume-upload-progress');
    const progressBar = progressContainer.querySelector('.progress-bar');
    const statusText = document.getElementById('job-resume-upload-status');
    const submitButton = document.getElementById('submit-resume-btn');
    
    progressContainer.style.display = 'block';
    submitButton.disabled = true;
    progressBar.style.width = '10%';
    statusText.textContent = 'Uploading resume...';
    
    try {
        // Prepare form data - need job description from the job object
        const formData = new FormData();
        formData.append('resumeFile', resumeFile);
        formData.append('jobDescription', job.description);
        
        // Add job requirements if available
        if (job.requirements) {
            formData.append('jobRequirements', job.requirements);
        }
        
        // Add user ID if logged in
        const currentUser = firebase.auth().currentUser;
        if (currentUser) {
            formData.append('userId', currentUser.uid);
        } else {
            throw new Error('You must be logged in to take a mock interview.');
        }
        
        // Add job ID for reference
        formData.append('jobId', job.id);
        
        // Update progress
        progressBar.style.width = '30%';
        statusText.textContent = 'Analyzing resume against job description...';
        
        // Make API call to backend
        const response = await fetch('/analyze-resume', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            // Check if it's a limit reached error
            const data = await response.json();
            if (data.limitReached) {
                // Show upgrade modal
                if (typeof showLimitReachedModal === 'function') {
                    showLimitReachedModal('resumeAnalyses', data);
                } else {
                    alert(`You've reached your limit for resume analyses. Please upgrade your plan to continue.`);
                }
                throw new Error('Usage limit reached');
            }
            throw new Error('Server error: ' + (response.statusText || 'Failed to analyze resume'));
        }
        
        // Get session ID from response
        const data = await response.json();
        const sessionId = data.sessionId;
        
        // Update progress
        progressBar.style.width = '60%';
        statusText.textContent = 'Processing resume analysis...';
        
        // Wait for analysis to complete (polling)
        await waitForAnalysisCompletion(sessionId, progressBar, statusText);
        
        // Hide the resume upload modal
        const resumeUploadModal = bootstrap.Modal.getInstance(document.getElementById('resume-upload-modal'));
        if (resumeUploadModal) {
            resumeUploadModal.hide();
        }
        
        // Proceed with payment and mock interview
        initiatePaymentProcess(sessionId, job);
        
    } catch (error) {
        console.error("Error in resume upload process:", error);
        statusText.textContent = `Error: ${error.message}`;
        progressBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
        progressBar.classList.add('bg-danger');
        
        // Re-enable submit button after error
        submitButton.disabled = false;
    }
}

/**
 * Waits for analysis completion by polling the server
 * @param {string} sessionId - Analysis session ID 
 * @param {HTMLElement} progressBar - Progress bar element to update
 * @param {HTMLElement} statusText - Status text element to update
 */
async function waitForAnalysisCompletion(sessionId, progressBar, statusText) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes timeout (5s * 60)
        
        const checkStatus = async () => {
            try {
                const response = await fetch(`/get-analysis-status/${sessionId}`);
                if (!response.ok) {
                    throw new Error('Failed to check analysis status');
                }
                
                const data = await response.json();
                
                // Update progress based on analysis progress
                if (data.progress) {
                    // Scale progress from 60% to 90% (reserving 90-100% for next steps)
                    const scaledProgress = 60 + (data.progress * 0.3);
                    progressBar.style.width = `${scaledProgress}%`;
                }
                
                // Update status text
                if (data.statusDetail) {
                    statusText.textContent = data.statusDetail;
                }
                
                // Check completion status
                if (data.status === 'completed') {
                    progressBar.style.width = '90%';
                    statusText.textContent = 'Analysis complete! Preparing interview...';
                    resolve(data);
                    return;
                } else if (data.status === 'failed') {
                    reject(new Error('Analysis failed: ' + (data.errors?.[0] || 'Unknown error')));
                    return;
                }
                
                // Check timeout
                attempts++;
                if (attempts >= maxAttempts) {
                    reject(new Error('Analysis timeout. Please try again later.'));
                    return;
                }
                
                // Continue polling
                setTimeout(checkStatus, 5000); // Check every 5 seconds
                
            } catch (error) {
                reject(error);
            }
        };
        
        // Start polling
        checkStatus();
    });
}

/**
 * Initiates payment process for mock interview
 * @param {string} sessionId - Analysis session ID
 * @param {Object} job - The job object
 */
function initiatePaymentProcess(sessionId, job) {
    // Create payment confirmation modal if it doesn't exist
    if (!document.getElementById('mock-payment-modal')) {
        const modalHTML = `
            <div class="modal fade" id="mock-payment-modal" tabindex="-1" aria-labelledby="mockPaymentModalLabel" aria-hidden="true">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="mockPaymentModalLabel">Interview Preparation</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="text-center mb-4">
                                <i class="fas fa-check-circle text-success fa-3x"></i>
                                <h4 class="mt-3">Resume Analysis Complete!</h4>
                                <p>Your resume has been successfully analyzed against the job requirements.</p>
                            </div>
                            
                            <div class="alert alert-info">
                                <i class="fas fa-info-circle me-2"></i>
                                <strong>Next Step:</strong> Continue to the mock interview for <strong class="job-title-placeholder"></strong>
                            </div>
                            
                            <div id="mock-payment-details">
                                <p class="text-center">This will use <strong>1 mock interview</strong> credit from your account.</p>
                                <p class="text-center text-muted small">Your account will be charged based on your current plan.</p>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="confirm-mock-payment-btn">
                                Continue to Interview
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add event listener for confirmation button
        document.getElementById('confirm-mock-payment-btn').addEventListener('click', function() {
            const confirmedSessionId = this.getAttribute('data-session-id');
            if (confirmedSessionId) {
                startMockInterview(confirmedSessionId);
            }
        });
    }
    
    // Update modal content with job info
    const jobTitleElement = document.querySelector('#mock-payment-modal .job-title-placeholder');
    if (jobTitleElement) {
        jobTitleElement.textContent = job.title || 'this position';
    }
    
    // Store session ID in confirm button
    const confirmBtn = document.getElementById('confirm-mock-payment-btn');
    if (confirmBtn) {
        confirmBtn.setAttribute('data-session-id', sessionId);
    }
    
    // Show the modal
    const mockPaymentModal = new bootstrap.Modal(document.getElementById('mock-payment-modal'));
    mockPaymentModal.show();
}

/**
 * Starts the mock interview process
 * @param {string} sessionId - Analysis session ID
 */
async function startMockInterview(sessionId) {
    // Hide the payment modal
    const mockPaymentModal = bootstrap.Modal.getInstance(document.getElementById('mock-payment-modal'));
    if (mockPaymentModal) {
        mockPaymentModal.hide();
    }
    
    try {
        // Make API call to start mock interview
        const response = await fetch('/start-mock-interview', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: sessionId,
                interviewType: 'general' // Using general type for job practice
            })
        });
        
        if (!response.ok) {
            // Check if it's a limit reached error
            const data = await response.json();
            if (data.limitReached) {
                // Show upgrade modal
                if (typeof showLimitReachedModal === 'function') {
                    showLimitReachedModal('mockInterviews', data);
                } else {
                    alert(`You've reached your limit for mock interviews. Please upgrade your plan to continue.`);
                }
                throw new Error('Usage limit reached');
            }
            throw new Error('Server error: ' + (response.statusText || 'Failed to start mock interview'));
        }
        
        // Get interview ID from response
        const data = await response.json();
        const interviewId = data.interviewId;
        
        // Navigate to mock interview UI
        navigateToMockInterview(interviewId);
        
    } catch (error) {
        console.error("Error starting mock interview:", error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Navigates to the mock interview UI
 * @param {string} interviewId - Interview ID
 */
function navigateToMockInterview(interviewId) {
    console.log(`Navigating to mock interview: ${interviewId}`);
    
    // Check if we're in the public or app view
    const isPublicView = document.getElementById('public-view').style.display !== 'none';
    
    if (isPublicView) {
        // Switch to app view
        document.getElementById('public-view').style.display = 'none';
        document.getElementById('app-view').style.display = 'flex';
        
        // Activate the mock interview tab
        const mockInterviewNav = document.querySelector('.nav-item[data-target="mock-interview"]');
        if (mockInterviewNav) {
            document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
            mockInterviewNav.classList.add('active');
            
            // Activate corresponding content section
            document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
            document.getElementById('mock-interview').classList.add('active');
        }
    } else {
        // Already in app view, just navigate to the mock interview section
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        document.querySelector('.nav-item[data-target="mock-interview"]')?.classList.add('active');
        
        document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
        document.getElementById('mock-interview')?.classList.add('active');
    }
    
    // Initialize the interview UI with the interview ID
    if (typeof initializeMockInterview === 'function') {
        initializeMockInterview(interviewId);
    } else {
        console.warn("initializeMockInterview function not found. Attempting fallback initialization.");
        
        // Basic fallback initialization
        const conversationContainer = document.getElementById('conversationContainer');
        if (conversationContainer) {
            // Clear previous conversations
            conversationContainer.innerHTML = '';
            
            // Fetch the initial conversation state
            fetch(`/get-interview-data/${interviewId}`)
                .then(response => {
                    if (!response.ok) throw new Error('Failed to load interview data');
                    return response.json();
                })
                .then(data => {
                    if (data.conversation && data.conversation.length > 0) {
                        // Display the initial greeting
                        const firstMessage = data.conversation[0];
                        if (firstMessage.role === 'assistant') {
                            const messageHTML = `
                                <div class="message interviewer-message">
                                    <div class="message-content">
                                        <p>${firstMessage.content}</p>
                                    </div>
                                </div>
                            `;
                            conversationContainer.innerHTML = messageHTML;
                        }
                    }
                })
                .catch(error => {
                    console.error('Error initializing interview:', error);
                    conversationContainer.innerHTML = `
                        <div class="message system-message">
                            <div class="message-content">
                                <p>There was an error loading the interview. Please try again.</p>
                            </div>
                        </div>
                    `;
                });
            
            // Store the interview ID for future API calls
            document.getElementById('mock-interview').setAttribute('data-interview-id', interviewId);
        }
    }
}

/**
 * Sets loading state for job listings container
 * @param {boolean} isLoading - Whether content is loading
 */
function setLoadingState(isLoading) {
    if (!jobListingsContainer) return;
    
    if (isLoading) {
        jobListingsContainer.innerHTML = `
            <div class="col-12 text-center py-5">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2">Loading job listings...</p>
            </div>
        `;
    }
}

/**
 * Formats a Firestore timestamp to a readable date
 * @param {FirebaseFirestore.Timestamp} timestamp - Firestore timestamp
 * @returns {string} Formatted date string
 */
function formatFirestoreDate(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== 'function') {
        return 'Date not available';
    }
    
    try {
        const date = timestamp.toDate();
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch (error) {
        console.error("Error formatting date:", error);
        return 'Invalid date';
    }
}

// Global variable to store the selected job for use after authentication
let selectedJobForMockInterview = null;

function takeMockInterview(jobId) {
    // First check if user is logged in
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        // Store the job ID for later use after authentication
        selectedJobForMockInterview = jobId;
        
        // Show login modal
        if (typeof showAuthModal === 'function') {
            // Add event listener for auth state changes
            firebase.auth().onAuthStateChanged(function(user) {
                if (user && selectedJobForMockInterview) {
                    // User is now signed in, continue with the job-specific flow
                    startJobSpecificResumeUpload(selectedJobForMockInterview);
                    // Reset the selected job to prevent duplicate handling
                    selectedJobForMockInterview = null;
                }
            });
            
            showAuthModal('signin');
        } else {
            alert('Please sign in to take a mock interview.');
        }
        return;
    }
    
    // User is already logged in, proceed directly
    startJobSpecificResumeUpload(jobId);
}

function startJobSpecificResumeUpload(jobId) {
    // Find job in the array
    const job = allJobs.find(j => j.id === jobId);
    
    if (!job) {
        console.error("Job not found for mock interview:", jobId);
        alert('Error loading job details. Please try again.');
        return;
    }
    
    // Create a modal for resume upload if it doesn't exist
    if (!document.getElementById('job-resume-upload-modal')) {
        const modalHTML = `
            <div class="modal fade" id="job-resume-upload-modal" tabindex="-1" aria-labelledby="jobResumeUploadModalLabel" aria-hidden="true">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="jobResumeUploadModalLabel">Upload Your Resume</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p class="mb-3">Upload your resume to tailor the mock interview for <strong id="job-title-display"></strong> at <strong id="company-name-display"></strong>.</p>
                            
                            <form id="job-resume-upload-form">
                                <div class="mb-3">
                                    <label for="job-resume-file" class="form-label">Resume (PDF format)</label>
                                    <input type="file" class="form-control" id="job-resume-file" accept=".pdf" required>
                                </div>
                                <div class="d-grid">
                                    <button type="submit" class="btn btn-primary" id="submit-resume-btn">
                                        <i class="fas fa-upload me-1"></i> Upload & Continue
                                    </button>
                                </div>
                            </form>
                            
                            <div id="job-resume-upload-progress" class="mt-3" style="display: none;">
                                <div class="progress mb-2">
                                    <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div>
                                </div>
                                <p class="text-center" id="job-resume-upload-status">Preparing...</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add event listener for form submission
        document.getElementById('job-resume-upload-form').addEventListener('submit', function(e) {
            e.preventDefault();
            processJobSpecificResumeUpload();
        });
    }
    
    // Update modal title and job info
    document.getElementById('jobResumeUploadModalLabel').textContent = `Upload Resume for ${job.title} Interview`;
    document.getElementById('job-title-display').textContent = job.title || 'the position';
    document.getElementById('company-name-display').textContent = job.companyName || 'the company';
    
    // Store the current job ID as a data attribute on the form for reference
    document.getElementById('job-resume-upload-form').setAttribute('data-job-id', jobId);
    
    // Show the modal
    const resumeUploadModal = new bootstrap.Modal(document.getElementById('job-resume-upload-modal'));
    resumeUploadModal.show();
}

function processJobSpecificResumeUpload() {
    const resumeFile = document.getElementById('job-resume-file').files[0];
    if (!resumeFile) {
        alert('Please select a resume file.');
        return;
    }
    
    const jobId = document.getElementById('job-resume-upload-form').getAttribute('data-job-id');
    if (!jobId) {
        alert('Job information is missing. Please try again.');
        return;
    }
    
    // Show progress UI
    const progressContainer = document.getElementById('job-resume-upload-progress');
    const progressBar = progressContainer.querySelector('.progress-bar');
    const statusText = document.getElementById('job-resume-upload-status');
    const submitButton = document.getElementById('submit-resume-btn');
    
    progressContainer.style.display = 'block';
    submitButton.disabled = true;
    progressBar.style.width = '10%';
    statusText.textContent = 'Uploading resume...';
    
    // Check if user can use resumeAnalyses feature
    if (window.irisAuth && typeof window.irisAuth.canUseFeature === 'function') {
        if (!window.irisAuth.canUseFeature('resumeAnalyses')) {
            // Update status message
            progressBar.style.width = '0%';
            progressBar.classList.add('bg-danger');
            statusText.textContent = 'Resume analysis limit reached. Please upgrade your plan.';
            
            // Show limit reached modal
            setTimeout(() => {
                // Hide the upload modal
                const resumeUploadModal = bootstrap.Modal.getInstance(document.getElementById('job-resume-upload-modal'));
                if (resumeUploadModal) {
                    resumeUploadModal.hide();
                }
                
                showLimitReachedModal('resumeAnalyses', {
                    used: window.irisAuth.getUserProfile()?.usage?.resumeAnalyses?.used || 0,
                    limit: window.irisAuth.getUserProfile()?.usage?.resumeAnalyses?.limit || 0,
                    plan: window.irisAuth.getUserProfile()?.plan || 'free'
                });
                
                // Re-enable submit button
                submitButton.disabled = false;
            }, 1000);
            
            return;
        }
    }
    
    // Get the current user ID
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        statusText.textContent = 'Error: You must be logged in to continue.';
        progressBar.classList.add('bg-danger');
        return;
    }
    
    // Increment usage counter for resumeAnalyses
    if (window.irisAuth && typeof window.irisAuth.incrementUsageCounter === 'function') {
        window.irisAuth.incrementUsageCounter('resumeAnalyses')
            .then(incrementResult => {
                console.log("Resume analysis usage incremented:", incrementResult);
                
                // Continue with uploading
                continueWithUpload();
            })
            .catch(error => {
                console.error("Error incrementing usage:", error);
                statusText.textContent = `Error: ${error.message}`;
                progressBar.classList.add('bg-danger');
                submitButton.disabled = false;
            });
    } else {
        // No usage tracking, continue with upload
        continueWithUpload();
    }
    
    function continueWithUpload() {
        // Prepare form data
        const formData = new FormData();
        formData.append('resumeFile', resumeFile);
        formData.append('userId', currentUser.uid);
        formData.append('jobId', jobId);
        
        // Make API call to backend
        fetch('/analyze-resume-for-job', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Failed to analyze resume');
                });
            }
            return response.json();
        })
        .then(data => {
            // Update progress
            progressBar.style.width = '50%';
            statusText.textContent = 'Analysis complete! Preparing interview...';
            
            // Hide the resume upload modal
            const resumeUploadModal = bootstrap.Modal.getInstance(document.getElementById('job-resume-upload-modal'));
            if (resumeUploadModal) {
                resumeUploadModal.hide();
            }
            
            // Continue with job-specific mock interview
            initiateJobSpecificInterview(data.sessionId, jobId);
        })
        .catch(error => {
            console.error("Error in resume upload process:", error);
            statusText.textContent = `Error: ${error.message}`;
            progressBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
            progressBar.classList.add('bg-danger');
            
            // Re-enable submit button after error
            submitButton.disabled = false;
        });
    }
}

function initiateJobSpecificInterview(sessionId, jobId) {
    // Show payment confirmation modal
    if (!document.getElementById('mock-payment-modal')) {
        createPaymentConfirmationModal();
    }
    
    // Get job details to display in the confirmation modal
    const job = allJobs.find(j => j.id === jobId);
    const jobTitle = job ? job.title : 'this position';
    const companyName = job ? job.companyName : 'the company';
    
    document.querySelector('#mock-payment-modal .job-title-placeholder').textContent = `${jobTitle} at ${companyName}`;
    
    // Store session ID and job ID in confirm button
    const confirmBtn = document.getElementById('confirm-mock-payment-btn');
    confirmBtn.setAttribute('data-session-id', sessionId);
    confirmBtn.setAttribute('data-job-id', jobId);
    
    // Update confirm button click handler for job-specific flow
    confirmBtn.onclick = function() {
        const confirmedSessionId = this.getAttribute('data-session-id');
        const confirmedJobId = this.getAttribute('data-job-id');
        if (confirmedSessionId && confirmedJobId) {
            startJobSpecificMockInterview(confirmedSessionId, confirmedJobId);
        }
    };
    
    // Show the modal
    const mockPaymentModal = new bootstrap.Modal(document.getElementById('mock-payment-modal'));
    mockPaymentModal.show();
}

function createPaymentConfirmationModal() {
    const modalHTML = `
        <div class="modal fade" id="mock-payment-modal" tabindex="-1" aria-labelledby="mockPaymentModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="mockPaymentModalLabel">Interview Preparation</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="text-center mb-4">
                            <i class="fas fa-check-circle text-success fa-3x"></i>
                            <h4 class="mt-3">Resume Analysis Complete!</h4>
                            <p>Your resume has been successfully analyzed against the job requirements.</p>
                        </div>
                        
                        <div class="alert alert-info">
                            <i class="fas fa-info-circle me-2"></i>
                            <strong>Next Step:</strong> Continue to the mock interview for <strong class="job-title-placeholder"></strong>
                        </div>
                        
                        <div id="mock-payment-details">
                            <p class="text-center">This will use <strong>1 mock interview</strong> credit from your account.</p>
                            <p class="text-center text-muted small">Your account will be charged based on your current plan.</p>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="confirm-mock-payment-btn">
                            Continue to Interview
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function startJobSpecificMockInterview(sessionId, jobId) {
    // Hide the payment modal
    const mockPaymentModal = bootstrap.Modal.getInstance(document.getElementById('mock-payment-modal'));
    if (mockPaymentModal) {
        mockPaymentModal.hide();
    }
    
    // Check if user can use mockInterviews feature again (in case usage changed)
    if (window.irisAuth && typeof window.irisAuth.canUseFeature === 'function') {
        if (!window.irisAuth.canUseFeature('mockInterviews')) {
            showLimitReachedModal('mockInterviews', {
                used: window.irisAuth.getUserProfile()?.usage?.mockInterviews?.used || 0,
                limit: window.irisAuth.getUserProfile()?.usage?.mockInterviews?.limit || 0,
                plan: window.irisAuth.getUserProfile()?.plan || 'free'
            });
            return;
        }
    }
    
    // Show a processing spinner
    if (!document.getElementById('processing-spinner-modal')) {
        const spinnerHTML = `
            <div class="modal fade" id="processing-spinner-modal" data-bs-backdrop="static" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-body text-center p-5">
                            <div class="spinner-border text-primary mb-3" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            <h5>Starting Interview...</h5>
                            <p>Please wait while we prepare your mock interview.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', spinnerHTML);
    }
    
    const spinnerModal = new bootstrap.Modal(document.getElementById('processing-spinner-modal'));
    spinnerModal.show();
    
    // Increment usage counter for mockInterviews
    let incrementPromise = Promise.resolve();
    if (window.irisAuth && typeof window.irisAuth.incrementUsageCounter === 'function') {
        incrementPromise = window.irisAuth.incrementUsageCounter('mockInterviews')
            .then(incrementResult => {
                console.log("Mock interview usage incremented:", incrementResult);
                return incrementResult;
            })
            .catch(error => {
                console.error("Error incrementing usage:", error);
                // Even if increment fails, we try to continue (server will verify limits)
                return { success: false, error: error.message };
            });
    }
    
    // After incrementing (or attempting to), make API call
    incrementPromise.then(() => {
        // Make API call to start job-specific mock interview
        return fetch('/job-specific-mock', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: sessionId,
                jobId: jobId,
                interviewType: 'general' // Default to general type
            })
        });
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                // Check if it's a limit reached error
                if (data.limitReached) {
                    // Show upgrade modal
                    if (typeof showLimitReachedModal === 'function') {
                        spinnerModal.hide();
                        showLimitReachedModal('mockInterviews', data);
                    } else {
                        throw new Error(`You've reached your limit for mock interviews. Please upgrade your plan to continue.`);
                    }
                } else {
                    throw new Error(data.error || 'Failed to start mock interview');
                }
            });
        }
        return response.json();
    })
    .then(data => {
        // Hide spinner
        spinnerModal.hide();
        
        // Get interview ID and navigate to mock interview UI
        const interviewId = data.interviewId;
        navigateToMockInterview(interviewId);
    })
    .catch(error => {
        console.error("Error starting job-specific mock interview:", error);
        
        // Hide spinner
        spinnerModal.hide();
        
        // Show error
        showMessage(`Error: ${error.message}`, 'danger');
    });
}

// Add support for showing limit reached modal
function showLimitReachedModal(featureType, usageData) {
    const featureLabels = {
        'resumeAnalyses': 'Resume Analyses',
        'mockInterviews': 'Mock Interviews',
        'pdfDownloads': 'PDF Downloads',
        'aiEnhance': 'AI Enhancements'
    };
    
    const featureLabel = featureLabels[featureType] || featureType;
    
    // Create modal if it doesn't exist
    if (!document.getElementById('limitReachedModal')) {
        const modalHTML = `
            <div class="modal fade" id="limitReachedModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header bg-warning">
                            <h5 class="modal-title"><i class="fas fa-exclamation-triangle me-2"></i> Limit Reached</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p id="limitReachedMessage">You've reached the limit for this feature on your current plan.</p>
                            <div class="alert alert-info">
                                <strong>You have two options:</strong>
                                <ul class="mb-0 mt-2">
                                    <li>Upgrade your plan for increased limits on all features</li>
                                    <li>Purchase individual add-ons for just this feature</li>
                                </ul>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            <button type="button" class="btn btn-success" id="limitReachedAddonBtn">
                                <i class="fas fa-plus-circle me-2"></i> Buy Add-ons
                            </button>
                            <button type="button" class="btn btn-primary" id="limitReachedUpgradeBtn">Upgrade Plan</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add event listeners
        document.getElementById('limitReachedAddonBtn').addEventListener('click', function() {
            // Hide this modal
            const limitModal = bootstrap.Modal.getInstance(document.getElementById('limitReachedModal'));
            if (limitModal) limitModal.hide();
            
            // Show addon purchase modal if it exists
            if (typeof showAddonPurchaseModal === 'function') {
                showAddonPurchaseModal(featureType);
            } else if (document.getElementById('addonPurchaseModal')) {
                const addonModal = new bootstrap.Modal(document.getElementById('addonPurchaseModal'));
                addonModal.show();
            } else {
                // Fallback to a simple message
                alert(`To purchase ${featureLabel} add-ons, please go to your profile page.`);
            }
        });
        
        document.getElementById('limitReachedUpgradeBtn').addEventListener('click', function() {
            // Hide this modal
            const limitModal = bootstrap.Modal.getInstance(document.getElementById('limitReachedModal'));
            if (limitModal) limitModal.hide();
            
            // Redirect to pricing tab
            document.getElementById('public-view').style.display = 'block';
            document.getElementById('app-view').style.display = 'none';
            
            // Show pricing tab
            document.querySelectorAll('.public-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            document.getElementById('pricing-tab').classList.add('active');
            
            // Update active state in nav
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
            });
            document.querySelector('.nav-link[data-tab="pricing-tab"]')?.classList.add('active');
            
            // Scroll to pricing
            window.scrollTo(0, 0);
        });
    }
    
    // Update message with feature-specific info
    const limitMessage = document.getElementById('limitReachedMessage');
    if (limitMessage) {
        const used = usageData?.used || 0;
        const limit = usageData?.limit || 0;
        const planName = usageData?.plan ? (usageData.plan.charAt(0).toUpperCase() + usageData.plan.slice(1)) : 'current';
        
        limitMessage.innerHTML = `You've reached your limit of <strong>${limit} ${featureLabel}</strong> on your ${planName} plan. You've used ${used} out of ${limit}.`;
    }
    
    // Show the modal
    const limitReachedModal = new bootstrap.Modal(document.getElementById('limitReachedModal'));
    limitReachedModal.show();
}