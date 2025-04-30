// IRIS Admin Dashboard - Main JavaScript File

// Global state
const adminState = {
    currentSection: 'dashboard',
    jobs: [],
    currentJobId: null,
    mustHaveSkills: [],
    niceToHaveSkills: [],
    chartInstances: {}
};

// ===== Job Listings Management =====

function initJobListings() {
    // Set up job search
    const searchInput = document.getElementById('job-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            filterJobs(this.value);
        });
    }
    
    // Set up job filters
    const filterLinks = document.querySelectorAll('.dropdown-item[data-filter]');
    filterLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const filter = this.getAttribute('data-filter');
            applyJobFilter(filter);
        });
    });
}

function loadJobListings() {
    // Show loading state
    document.getElementById('jobs-table-body').innerHTML = `
        <tr>
            <td colspan="7" class="text-center py-4">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                Loading job listings...
            </td>
        </tr>
    `;
    
    // Fetch jobs from Firestore
    return new Promise((resolve, reject) => {
        if (!firebase.firestore) {
            showMessage('Firestore not available', 'danger');
            return reject(new Error('Firestore not available'));
        }
        
        firebase.firestore().collection('jobPostings')
            .orderBy('createdAt', 'desc')
            .get()
            .then(snapshot => {
                adminState.jobs = [];
                snapshot.forEach(doc => {
                    adminState.jobs.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                
                // Render jobs table
                renderJobListings(adminState.jobs);
                resolve(adminState.jobs);
            })
            .catch(error => {
                console.error('Error loading job listings:', error);
                showMessage(`Error loading job listings: ${error.message}`, 'danger');
                
                // Show error in table
                document.getElementById('jobs-table-body').innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center text-danger py-4">
                            <i class="fas fa-exclamation-circle me-2"></i>
                            Error loading job listings. Please try again.
                        </td>
                    </tr>
                `;
                reject(error);
            });
    });
}

function renderJobListings(jobs) {
    const tableBody = document.getElementById('jobs-table-body');
    if (!tableBody) return;
    
    if (jobs.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4">
                    No job listings found. Click "Add New Job" to create your first job posting.
                </td>
            </tr>
        `;
        return;
    }
    
    const now = new Date();
    const jobRows = jobs.map(job => {
        const deadline = new Date(job.applicationDeadline);
        const isExpired = deadline < now;
        const postedDate = job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'N/A';
        const deadlineFormatted = new Date(job.applicationDeadline).toLocaleDateString();
        
        let statusBadge = '';
        if (isExpired) {
            statusBadge = '<span class="badge bg-danger">Expired</span>';
        } else {
            const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
            if (daysLeft <= 3) {
                statusBadge = `<span class="badge bg-warning text-dark">Closing Soon (${daysLeft} day${daysLeft !== 1 ? 's' : ''})</span>`;
            } else {
                statusBadge = '<span class="badge bg-success">Active</span>';
            }
        }
        
        return `
            <tr data-job-id="${job.id}">
                <td>${job.jobTitle}</td>
                <td>${job.companyName}</td>
                <td>${job.category || 'Uncategorized'}</td>
                <td>${postedDate}</td>
                <td>${deadlineFormatted}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="job-actions">
                        <button class="btn btn-sm btn-outline-primary view-job-btn" data-job-id="${job.id}" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-warning edit-job-btn" data-job-id="${job.id}" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger delete-job-btn" data-job-id="${job.id}" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    tableBody.innerHTML = jobRows;
    
    // Add event listeners to action buttons
    tableBody.querySelectorAll('.view-job-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const jobId = this.getAttribute('data-job-id');
            viewJobDetails(jobId);
        });
    });
    
    tableBody.querySelectorAll('.edit-job-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const jobId = this.getAttribute('data-job-id');
            editJob(jobId);
        });
    });
    
    tableBody.querySelectorAll('.delete-job-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const jobId = this.getAttribute('data-job-id');
            showDeleteJobModal(jobId);
        });
    });
}

function filterJobs(searchTerm) {
    if (!searchTerm) {
        renderJobListings(adminState.jobs);
        return;
    }
    
    const searchTermLower = searchTerm.toLowerCase();
    const filteredJobs = adminState.jobs.filter(job => {
        return (
            job.jobTitle.toLowerCase().includes(searchTermLower) ||
            job.companyName.toLowerCase().includes(searchTermLower) ||
            job.category?.toLowerCase().includes(searchTermLower) ||
            job.location?.toLowerCase().includes(searchTermLower)
        );
    });
    
    renderJobListings(filteredJobs);
}

function applyJobFilter(filter) {
    const now = new Date();
    let filteredJobs = [...adminState.jobs];
    
    switch (filter) {
        case 'active':
            filteredJobs = adminState.jobs.filter(job => {
                const deadline = new Date(job.applicationDeadline);
                return deadline >= now;
            });
            break;
        case 'expired':
            filteredJobs = adminState.jobs.filter(job => {
                const deadline = new Date(job.applicationDeadline);
                return deadline < now;
            });
            break;
        case 'full-time':
            filteredJobs = adminState.jobs.filter(job => job.jobType === 'full-time');
            break;
        case 'intern':
            filteredJobs = adminState.jobs.filter(job => job.jobType === 'internship');
            break;
        default:
            // 'all' - no filtering needed
            break;
    }
    
    renderJobListings(filteredJobs);
}

function viewJobDetails(jobId) {
    const job = adminState.jobs.find(job => job.id === jobId);
    if (!job) {
        showMessage('Job not found', 'danger');
        return;
    }
    
    // Populate modal with job details
    const contentDiv = document.getElementById('job-details-content');
    const deadline = new Date(job.applicationDeadline);
    const isExpired = deadline < new Date();
    const deadlineFormatted = deadline.toLocaleDateString();
    const postedDate = job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'N/A';
    
    // Format skills lists
    const mustHaveSkillsHtml = job.mustHaveSkills?.length 
        ? `<ul>${job.mustHaveSkills.map(skill => `<li>${skill}</li>`).join('')}</ul>`
        : '<em>None specified</em>';
        
    const niceToHaveSkillsHtml = job.niceToHaveSkills?.length 
        ? `<ul>${job.niceToHaveSkills.map(skill => `<li>${skill}</li>`).join('')}</ul>`
        : '<em>None specified</em>';
    
    // Format previous questions
    const previousQuestionsHtml = job.previousQuestions 
        ? `<ul>${job.previousQuestions.split('\n').filter(q => q.trim()).map(q => `<li>${q}</li>`).join('')}</ul>`
        : '<em>None provided</em>';
    
    contentDiv.innerHTML = `
        <div class="job-details">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                    <h3 class="mb-1">${job.jobTitle}</h3>
                    <h5>${job.companyName} • ${job.location}</h5>
                </div>
                <div>
                    <span class="badge bg-secondary">${job.category || 'Uncategorized'}</span>
                    <span class="badge ${isExpired ? 'bg-danger' : 'bg-success'}">${isExpired ? 'Expired' : 'Active'}</span>
                </div>
            </div>
            
            <div class="row mb-4">
                <div class="col-md-6">
                    <p><strong>Job Type:</strong> ${job.jobType || 'Not specified'}</p>
                    <p><strong>Experience Level:</strong> ${job.experience || 'Not specified'}</p>
                    <p><strong>Salary Range:</strong> ${job.salaryRange || 'Not specified'}</p>
                </div>
                <div class="col-md-6">
                    <p><strong>Posted Date:</strong> ${postedDate}</p>
                    <p><strong>Application Deadline:</strong> ${deadlineFormatted}</p>
                    <p><strong>Number of Openings:</strong> ${job.numOpenings || '1'}</p>
                </div>
            </div>
            
            <div class="row mb-3">
                <div class="col-md-6">
                    <h5>Must-Have Skills</h5>
                    ${mustHaveSkillsHtml}
                </div>
                <div class="col-md-6">
                    <h5>Nice-to-Have Skills</h5>
                    ${niceToHaveSkillsHtml}
                </div>
            </div>
            
            <h5>Job Description</h5>
            <div class="mb-3 job-description border-bottom pb-3">
                ${job.jobDescription.replace(/\n/g, '<br>')}
            </div>
            
            ${job.responsibilities ? `
                <h5>Key Responsibilities</h5>
                <div class="mb-3 border-bottom pb-3">
                    ${job.responsibilities.replace(/\n/g, '<br>')}
                </div>
            ` : ''}
            
            <div class="row mb-3">
                ${job.education ? `
                    <div class="col-md-6">
                        <h5>Education Requirements</h5>
                        <p>${job.education}</p>
                    </div>
                ` : ''}
                
                ${job.jobLink ? `
                    <div class="col-md-6">
                        <h5>Original Job Posting</h5>
                        <p><a href="${job.jobLink}" target="_blank">${job.jobLink}</a></p>
                    </div>
                ` : ''}
            </div>
            
            ${job.previousQuestions ? `
                <h5>Previous Interview Questions</h5>
                <div class="mb-3">
                    ${previousQuestionsHtml}
                </div>
            ` : ''}
            
            ${job.glassdoorInfo ? `
                <h5>Glassdoor/Reviews Information</h5>
                <div class="mb-3">
                    ${job.glassdoorInfo.replace(/\n/g, '<br>')}
                </div>
            ` : ''}
            
            ${job.additionalNotes ? `
                <h5>Additional Notes</h5>
                <div class="mb-3">
                    ${job.additionalNotes.replace(/\n/g, '<br>')}
                </div>
            ` : ''}
        </div>
    `;
    
    // Update Edit button
    document.getElementById('edit-job-btn').setAttribute('data-job-id', jobId);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('job-details-modal'));
    modal.show();
    
    // Add event listener for edit button
    document.getElementById('edit-job-btn').addEventListener('click', function() {
        const jobId = this.getAttribute('data-job-id');
        modal.hide();
        editJob(jobId);
    });
}

function editJob(jobId) {
    const job = adminState.jobs.find(job => job.id === jobId);
    if (!job) {
        showMessage('Job not found', 'danger');
        return;
    }
    
    // Navigate to add/edit job section
    navigateToSection('add-job');
    
    // Populate form with job data
    document.getElementById('job-title').value = job.jobTitle || '';
    document.getElementById('company-name').value = job.companyName || '';
    document.getElementById('job-category').value = job.category || '';
    document.getElementById('job-experience').value = job.experience || '';
    document.getElementById('job-type').value = job.jobType || '';
    document.getElementById('application-deadline').value = formatDateForInput(job.applicationDeadline);
    document.getElementById('salary-range').value = job.salaryRange || '';
    document.getElementById('location').value = job.location || '';
    document.getElementById('education').value = job.education || '';
    document.getElementById('job-description').value = job.jobDescription || '';
    document.getElementById('responsibilities').value = job.responsibilities || '';
    document.getElementById('job-link').value = job.jobLink || '';
    document.getElementById('num-openings').value = job.numOpenings || '1';
    document.getElementById('previous-questions').value = job.previousQuestions || '';
    document.getElementById('glassdoor-info').value = job.glassdoorInfo || '';
    document.getElementById('additional-notes').value = job.additionalNotes || '';
    
    // Set skills
    adminState.mustHaveSkills = job.mustHaveSkills || [];
    adminState.niceToHaveSkills = job.niceToHaveSkills || [];
    
    // Update skills containers
    updateSkillsContainers();
    
    // Set the current job ID
    adminState.currentJobId = jobId;
    
    // Update form title to indicate editing
    document.querySelector('#add-job-section .admin-header h2').innerHTML = `
        <i class="fas fa-edit me-2"></i>Edit Job: ${job.jobTitle}
    `;
    
    // Update submit button text
    document.querySelector('#add-job-form button[type="submit"]').innerHTML = `
        <i class="fas fa-save me-1"></i>Update Job Posting
    `;
}

function showDeleteJobModal(jobId) {
    const job = adminState.jobs.find(job => job.id === jobId);
    if (!job) {
        showMessage('Job not found', 'danger');
        return;
    }
    
    // Populate modal with job info
    document.getElementById('delete-job-title').textContent = job.jobTitle;
    document.getElementById('delete-job-company').textContent = job.companyName;
    
    // Set job ID for delete confirmation
    document.getElementById('confirm-delete-job').setAttribute('data-job-id', jobId);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('delete-job-modal'));
    modal.show();
    
    // Add event listener for delete confirmation
    document.getElementById('confirm-delete-job').addEventListener('click', function() {
        const jobId = this.getAttribute('data-job-id');
        deleteJob(jobId);
        modal.hide();
    });
}

function deleteJob(jobId) {
    if (!firebase.firestore) {
        showMessage('Firestore not available', 'danger');
        return;
    }
    
    // Show loading message
    showMessage('Deleting job posting...', 'info');
    
    firebase.firestore().collection('jobPostings').doc(jobId).delete()
        .then(() => {
            // Remove job from local state
            adminState.jobs = adminState.jobs.filter(job => job.id !== jobId);
            
            // Update UI
            renderJobListings(adminState.jobs);
            updateDashboardCounts();
            updateRecentJobs();
            updateJobCategoriesChart();
            
            showMessage('Job posting deleted successfully', 'success');
        })
        .catch(error => {
            console.error('Error deleting job:', error);
            showMessage(`Error deleting job: ${error.message}`, 'danger');
        });
}

// ===== Add/Edit Job Form =====

function initAddJobForm() {
    // Set up skills input handlers
    initSkillsInputs();
    
    // Set up reset form button
    document.getElementById('reset-form')?.addEventListener('click', function() {
        resetJobForm();
    });
    
    // Set up preview button
    document.getElementById('preview-job')?.addEventListener('click', function() {
        previewJob();
    });
    
    // Set up form submission
    document.getElementById('add-job-form')?.addEventListener('submit', function(e) {
        e.preventDefault();
        saveJob();
    });
    
    // Set up preview submit button
    document.getElementById('preview-submit')?.addEventListener('click', function() {
        saveJob();
        // Hide the preview modal
        bootstrap.Modal.getInstance(document.getElementById('job-preview-modal')).hide();
    });
}

function initSkillsInputs() {
    // Must-have skills
    const mustHaveInput = document.getElementById('must-have-skills-input');
    const addMustHaveBtn = document.getElementById('add-must-have-skill');
    
    if (mustHaveInput && addMustHaveBtn) {
        // Add skill when button is clicked
        addMustHaveBtn.addEventListener('click', function() {
            const skill = mustHaveInput.value.trim();
            if (skill) {
                addSkill(skill, 'must-have');
                mustHaveInput.value = '';
            }
        });
        
        // Add skill when Enter is pressed
        mustHaveInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const skill = this.value.trim();
                if (skill) {
                    addSkill(skill, 'must-have');
                    this.value = '';
                }
            }
        });
    }
    
    // Nice-to-have skills
    const niceToHaveInput = document.getElementById('nice-to-have-skills-input');
    const addNiceToHaveBtn = document.getElementById('add-nice-to-have-skill');
    
    if (niceToHaveInput && addNiceToHaveBtn) {
        // Add skill when button is clicked
        addNiceToHaveBtn.addEventListener('click', function() {
            const skill = niceToHaveInput.value.trim();
            if (skill) {
                addSkill(skill, 'nice-to-have');
                niceToHaveInput.value = '';
            }
        });
        
        // Add skill when Enter is pressed
        niceToHaveInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const skill = this.value.trim();
                if (skill) {
                    addSkill(skill, 'nice-to-have');
                    this.value = '';
                }
            }
        });
    }
}

function addSkill(skill, type) {
    // Add to appropriate array
    if (type === 'must-have') {
        // Check for duplicates
        if (!adminState.mustHaveSkills.includes(skill)) {
            adminState.mustHaveSkills.push(skill);
        }
    } else {
        // Check for duplicates
        if (!adminState.niceToHaveSkills.includes(skill)) {
            adminState.niceToHaveSkills.push(skill);
        }
    }
    
    // Update UI
    updateSkillsContainers();
    
    // Update hidden inputs
    updateHiddenInputs();
}

function removeSkill(skill, type) {
    // Remove from appropriate array
    if (type === 'must-have') {
        adminState.mustHaveSkills = adminState.mustHaveSkills.filter(s => s !== skill);
    } else {
        adminState.niceToHaveSkills = adminState.niceToHaveSkills.filter(s => s !== skill);
    }
    
    // Update UI
    updateSkillsContainers();
    
    // Update hidden inputs
    updateHiddenInputs();
}

function updateSkillsContainers() {
    // Update must-have skills container
    const mustHaveContainer = document.getElementById('must-have-skills-container');
    if (mustHaveContainer) {
        mustHaveContainer.innerHTML = '';
        
        adminState.mustHaveSkills.forEach(skill => {
            const tag = document.createElement('div');
            tag.className = 'tag';
            tag.innerHTML = `
                ${skill}
                <button type="button" class="remove-skill" data-skill="${skill}" data-type="must-have">
                    <i class="fas fa-times"></i>
                </button>
            `;
            mustHaveContainer.appendChild(tag);
        });
        
        // Add event listeners to remove buttons
        mustHaveContainer.querySelectorAll('.remove-skill').forEach(btn => {
            btn.addEventListener('click', function() {
                const skill = this.getAttribute('data-skill');
                const type = this.getAttribute('data-type');
                removeSkill(skill, type);
            });
        });
    }
    
    // Update nice-to-have skills container
    const niceToHaveContainer = document.getElementById('nice-to-have-skills-container');
    if (niceToHaveContainer) {
        niceToHaveContainer.innerHTML = '';
        
        adminState.niceToHaveSkills.forEach(skill => {
            const tag = document.createElement('div');
            tag.className = 'tag';
            tag.innerHTML = `
                ${skill}
                <button type="button" class="remove-skill" data-skill="${skill}" data-type="nice-to-have">
                    <i class="fas fa-times"></i>
                </button>
            `;
            niceToHaveContainer.appendChild(tag);
        });
        
        // Add event listeners to remove buttons
        niceToHaveContainer.querySelectorAll('.remove-skill').forEach(btn => {
            btn.addEventListener('click', function() {
                const skill = this.getAttribute('data-skill');
                const type = this.getAttribute('data-type');
                removeSkill(skill, type);
            });
        });
    }
}

function updateHiddenInputs() {
    // Update must-have skills hidden input
    const mustHaveInput = document.getElementById('must-have-skills');
    if (mustHaveInput) {
        mustHaveInput.value = adminState.mustHaveSkills.join(',');
    }
    
    // Update nice-to-have skills hidden input
    const niceToHaveInput = document.getElementById('nice-to-have-skills');
    if (niceToHaveInput) {
        niceToHaveInput.value = adminState.niceToHaveSkills.join(',');
    }
}

function resetJobForm() {
    // Reset form fields
    document.getElementById('add-job-form').reset();
    
    // Clear skills
    adminState.mustHaveSkills = [];
    adminState.niceToHaveSkills = [];
    
    // Update UI
    updateSkillsContainers();
    
    // Reset the current job ID
    adminState.currentJobId = null;
    
    // Reset form title
    document.querySelector('#add-job-section .admin-header h2').innerHTML = `
        <i class="fas fa-plus-circle me-2"></i>Add New Job
    `;
    
    // Reset submit button text
    document.querySelector('#add-job-form button[type="submit"]').innerHTML = `
        <i class="fas fa-save me-1"></i>Save Job Posting
    `;
}

function previewJob() {
    // Get form data
    const jobData = getJobFormData();
    
    // Validate form
    if (!validateJobForm()) {
        // Form validation will show appropriate messages
        return;
    }
    
    // Populate preview modal
    const contentDiv = document.getElementById('job-preview-content');
    const deadlineFormatted = new Date(jobData.applicationDeadline).toLocaleDateString();
    
    // Format skills lists
    const mustHaveSkillsHtml = jobData.mustHaveSkills.length 
        ? `<ul>${jobData.mustHaveSkills.map(skill => `<li>${skill}</li>`).join('')}</ul>`
        : '<em>None specified</em>';
        
    const niceToHaveSkillsHtml = jobData.niceToHaveSkills.length 
        ? `<ul>${jobData.niceToHaveSkills.map(skill => `<li>${skill}</li>`).join('')}</ul>`
        : '<em>None specified</em>';
    
    // Format previous questions
    const previousQuestionsHtml = jobData.previousQuestions 
        ? `<ul>${jobData.previousQuestions.split('\n').filter(q => q.trim()).map(q => `<li>${q}</li>`).join('')}</ul>`
        : '<em>None provided</em>';
    
    contentDiv.innerHTML = `
        <div class="job-preview">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                    <h3 class="mb-1">${jobData.jobTitle}</h3>
                    <h5>${jobData.companyName} • ${jobData.location}</h5>
                </div>
                <div>
                    <span class="badge bg-secondary">${jobData.category || 'Uncategorized'}</span>
                    <span class="badge bg-success">New</span>
                </div>
            </div>
            
            <div class="row mb-4">
                <div class="col-md-6">
                    <p><strong>Job Type:</strong> ${jobData.jobType || 'Not specified'}</p>
                    <p><strong>Experience Level:</strong> ${jobData.experience || 'Not specified'}</p>
                    <p><strong>Salary Range:</strong> ${jobData.salaryRange || 'Not specified'}</p>
                </div>
                <div class="col-md-6">
                    <p><strong>Application Deadline:</strong> ${deadlineFormatted}</p>
                    <p><strong>Number of Openings:</strong> ${jobData.numOpenings || '1'}</p>
                    ${jobData.education ? `<p><strong>Education:</strong> ${jobData.education}</p>` : ''}
                </div>
            </div>
            
            <div class="row mb-3">
                <div class="col-md-6">
                    <h5>Must-Have Skills</h5>
                    ${mustHaveSkillsHtml}
                </div>
                <div class="col-md-6">
                    <h5>Nice-to-Have Skills</h5>
                    ${niceToHaveSkillsHtml}
                </div>
            </div>
            
            <h5>Job Description</h5>
            <div class="mb-3 job-description border-bottom pb-3">
                ${jobData.jobDescription.replace(/\n/g, '<br>')}
            </div>
            
            ${jobData.responsibilities ? `
                <h5>Key Responsibilities</h5>
                <div class="mb-3 border-bottom pb-3">
                    ${jobData.responsibilities.replace(/\n/g, '<br>')}
                </div>
            ` : ''}
            
            ${jobData.previousQuestions ? `
                <h5>Previous Interview Questions</h5>
                <div class="mb-3">
                    ${previousQuestionsHtml}
                </div>
            ` : ''}
            
            ${jobData.glassdoorInfo ? `
                <h5>Glassdoor/Reviews Information</h5>
                <div class="mb-3">
                    ${jobData.glassdoorInfo.replace(/\n/g, '<br>')}
                </div>
            ` : ''}
            
            ${jobData.additionalNotes ? `
                <h5>Additional Notes</h5>
                <div class="mb-3">
                    ${jobData.additionalNotes.replace(/\n/g, '<br>')}
                </div>
            ` : ''}
        </div>
    `;
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('job-preview-modal'));
    modal.show();
}

function getJobFormData() {
    return {
        jobTitle: document.getElementById('job-title').value.trim(),
        companyName: document.getElementById('company-name').value.trim(),
        category: document.getElementById('job-category').value,
        experience: document.getElementById('job-experience').value,
        jobType: document.getElementById('job-type').value,
        applicationDeadline: document.getElementById('application-deadline').value,
        salaryRange: document.getElementById('salary-range').value.trim(),
        location: document.getElementById('location').value.trim(),
        education: document.getElementById('education').value.trim(),
        mustHaveSkills: adminState.mustHaveSkills,
        niceToHaveSkills: adminState.niceToHaveSkills,
        jobDescription: document.getElementById('job-description').value.trim(),
        responsibilities: document.getElementById('responsibilities').value.trim(),
        jobLink: document.getElementById('job-link').value.trim(),
        numOpenings: document.getElementById('num-openings').value,
        previousQuestions: document.getElementById('previous-questions').value.trim(),
        glassdoorInfo: document.getElementById('glassdoor-info').value.trim(),
        additionalNotes: document.getElementById('additional-notes').value.trim()
    };
}

function validateJobForm() {
    let isValid = true;
    const requiredFields = [
        'job-title',
        'company-name',
        'job-category',
        'job-experience',
        'job-type',
        'application-deadline',
        'location',
        'job-description'
    ];
    
    // Check required fields
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field.value.trim()) {
            field.classList.add('is-invalid');
            isValid = false;
        } else {
            field.classList.remove('is-invalid');
        }
    });
    
    // Check must-have skills
    if (adminState.mustHaveSkills.length === 0) {
        document.getElementById('must-have-skills-input').classList.add('is-invalid');
        isValid = false;
    } else {
        document.getElementById('must-have-skills-input').classList.remove('is-invalid');
    }
    
    if (!isValid) {
        showMessage('Please fill in all required fields', 'warning');
    }
    
    return isValid;
}

function saveJob() {
    // Get form data
    const jobData = getJobFormData();
    
    // Validate form
    if (!validateJobForm()) {
        return;
    }
    
    // Check if Firestore is available
    if (!firebase.firestore) {
        showMessage('Firestore not available', 'danger');
        return;
    }
    
    // Prepare data for saving
    const data = {
        ...jobData,
        createdAt: adminState.currentJobId ? firebase.firestore.FieldValue.serverTimestamp() : firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Show loading message
    showMessage(adminState.currentJobId ? 'Updating job posting...' : 'Saving job posting...', 'info');
    
    const jobsCollection = firebase.firestore().collection('jobPostings');
    let savePromise;
    
    if (adminState.currentJobId) {
        // Update existing job
        savePromise = jobsCollection.doc(adminState.currentJobId).update(data);
    } else {
        // Add new job
        savePromise = jobsCollection.add(data);
    }
    
    savePromise
        .then(result => {
            const jobId = adminState.currentJobId || (result?.id);
            
            // Show success message
            showMessage(
                adminState.currentJobId 
                    ? 'Job posting updated successfully!' 
                    : 'Job posting created successfully!', 
                'success'
            );
            
            // Reset form
            resetJobForm();
            
            // Refresh job listings
            loadJobListings().then(() => {
                // Update dashboard
                updateDashboardCounts();
                updateRecentJobs();
                updateJobCategoriesChart();
            });
            
            // Navigate to job listings
            navigateToSection('jobs');
        })
        .catch(error => {
            console.error('Error saving job:', error);
            showMessage(`Error saving job: ${error.message}`, 'danger');
        });
}

// ===== Helper Functions =====

function formatDateForInput(dateString) {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
}

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

function checkAdminAccess(user) {
    // For now, we'll consider all authenticated users as admins
    // In a real app, you'd check a specific admin role or permission
    
    // If you want to implement proper admin checking:
    // 1. Add an 'isAdmin' field to your users collection
    // 2. Check that field here
    
    /*
    if (firebase.firestore) {
        firebase.firestore().collection('users').doc(user.uid).get()
            .then(doc => {
                if (doc.exists && doc.data().isAdmin) {
                    // User is admin, proceed
                } else {
                    // Not admin, redirect
                    showMessage('You do not have admin access', 'danger');
                    window.location.href = 'index.html';
                }
            })
            .catch(error => {
                console.error('Error checking admin status:', error);
                showMessage('Error verifying admin status', 'danger');
                window.location.href = 'index.html';
            });
    }
    */
    
    // For now, we just return true
    return true;
}

function updateUserProfileUI(user) {
    // Update UI elements showing user info
    const userDisplayElements = document.querySelectorAll('.user-display-name');
    const userEmailElements = document.querySelectorAll('.user-email');
    const userAvatarElements = document.querySelectorAll('.user-avatar');

    const displayName = user.displayName || user.email.split('@')[0];
    const email = user.email;
    const photoURL = user.photoURL || 'https://i.stack.imgur.com/34AD2.jpg'; // Default avatar

    userDisplayElements.forEach(el => el.textContent = displayName);
    userEmailElements.forEach(el => el.textContent = email);
    userAvatarElements.forEach(el => {
        if (el.tagName === 'IMG') {
            el.src = photoURL;
            el.alt = displayName;
        }
    });
}

// Document ready function
document.addEventListener('DOMContentLoaded', function() {
    // Check if Firebase auth module is available
    if (typeof irisAuth === 'undefined') {
        showMessage('Firebase authentication module not loaded. Some features may not work properly.', 'warning');
    } else {
        // Check if user is authenticated
        const currentUser = irisAuth.getCurrentUser();
        if (!currentUser) {
            // If not authenticated, redirect to main login page
            window.location.href = 'index.html';
            return;
        }
        
        // Check if user is admin (you'll need to implement this logic)
        checkAdminAccess(currentUser);
        
        // Update UI with user info
        updateUserProfileUI(currentUser);
    }
    
    // Initialize the dashboard
    initNavigation();
    initDashboard();
    initJobListings();
    initAddJobForm();
    
    // Refresh data
    loadJobListings();
    
    // Handle sign out
    document.querySelector('.signout-button')?.addEventListener('click', function() {
        if (typeof irisAuth !== 'undefined' && typeof irisAuth.signOut === 'function') {
            irisAuth.signOut().then(() => {
                window.location.href = 'index.html';
            });

// ===== Navigation and Section Management =====

function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link[data-section]');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const sectionId = this.getAttribute('data-section');
            navigateToSection(sectionId);
        });
    });
    
    // Add a click handler for the "Add Job" button in job listings
    document.getElementById('add-job-btn')?.addEventListener('click', function() {
        navigateToSection('add-job');
    });
}

function navigateToSection(sectionId) {
    // Update active navigation link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-section') === sectionId) {
            link.classList.add('active');
        }
    });
    
    // Hide all sections and show the target section
    document.querySelectorAll('.admin-section').forEach(section => {
        section.style.display = 'none';
    });
    
    const targetSection = document.getElementById(`${sectionId}-section`);
    if (targetSection) {
        targetSection.style.display = 'block';
    }
    
    // Save current section to state
    adminState.currentSection = sectionId;
    
    // Perform section-specific initializations if needed
    if (sectionId === 'dashboard') {
        refreshDashboardStats();
    } else if (sectionId === 'jobs') {
        loadJobListings();
    }
}

// ===== Dashboard Initialization & Functions =====

function initDashboard() {
    // Initialize dashboard charts
    initJobCategoriesChart();
    
    // Set up refresh button
    document.getElementById('refresh-dashboard')?.addEventListener('click', function() {
        refreshDashboardStats();
    });
}

function refreshDashboardStats() {
    // Fetch latest data and update dashboard
    loadJobListings().then(() => {
        updateDashboardCounts();
        updateRecentJobs();
        updateJobCategoriesChart();
    });
}

function updateDashboardCounts() {
    const totalJobs = adminState.jobs.length;
    const now = new Date();
    
    // Count active jobs (deadline hasn't passed)
    const activeJobs = adminState.jobs.filter(job => {
        const deadline = new Date(job.applicationDeadline);
        return deadline >= now;
    }).length;
    
    // For mock interviews count, we would typically fetch this from the server
    // But for now, we'll just use a placeholder value
    const mockInterviews = 0; // This should be fetched from your database in a real app
    
    // Update the UI
    document.getElementById('total-jobs-count').textContent = totalJobs;
    document.getElementById('active-jobs-count').textContent = activeJobs;
    document.getElementById('interview-count').textContent = mockInterviews;
}

function updateRecentJobs() {
    const recentJobsContainer = document.getElementById('recent-jobs');
    if (!recentJobsContainer) return;
    
    // Get the 5 most recent jobs
    const recentJobs = [...adminState.jobs]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);
    
    if (recentJobs.length === 0) {
        recentJobsContainer.innerHTML = '<p class="text-center py-3 text-muted">No jobs found. Add your first job posting.</p>';
        return;
    }
    
    // Create HTML for recent jobs
    const jobsHTML = recentJobs.map(job => {
        const deadlineDate = new Date(job.applicationDeadline);
        const isExpired = deadlineDate < new Date();
        const statusClass = isExpired ? 'text-danger' : 'text-success';
        const statusText = isExpired ? 'Expired' : 'Active';
        
        return `
            <div class="job-card p-3 border-bottom">
                <div class="d-flex justify-content-between">
                    <div>
                        <h6 class="mb-1">${job.jobTitle}</h6>
                        <div class="text-muted small">${job.companyName} • ${job.location}</div>
                    </div>
                    <div>
                        <span class="badge bg-secondary">${job.category}</span>
                        <span class="badge ${isExpired ? 'bg-danger' : 'bg-success'}">${statusText}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    recentJobsContainer.innerHTML = jobsHTML;
}

function initJobCategoriesChart() {
    const ctx = document.getElementById('job-categories-chart');
    if (!ctx) return;
    
    // Initialize with empty data
    adminState.chartInstances.jobCategories = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    '#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b',
                    '#6f42c1', '#5a5c69', '#858796', '#f8f9fc', '#3a3b45'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            },
            cutout: '70%'
        }
    });
}

function updateJobCategoriesChart() {
    // Count jobs by category
    const categoryCounts = {};
    adminState.jobs.forEach(job => {
        const category = job.category || 'Uncategorized';
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });
    
    // Format data for the chart
    const labels = Object.keys(categoryCounts);
    const data = Object.values(categoryCounts);
    
    // Update the chart
    if (adminState.chartInstances.jobCategories) {
        adminState.chartInstances.jobCategories.data.labels = labels;
        adminState.chartInstances.jobCategories.data.datasets[0].data = data;
        adminState.chartInstances.jobCategories.update();
    }
}
        }
    });
});