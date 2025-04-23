// js/modules/firestoreService.js
import { db } from '../config/firebase-config.js'; // Import Firestore instance
import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    orderBy, // Optional: for sorting
    limit, // Optional: for pagination
    startAfter // Optional: for pagination
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

/**
 * Fetches the profile data for the currently logged-in teacher.
 * Includes role and assignment details.
 * @param {string} uid - The teacher's Firebase UID.
 * @returns {Promise<object|null>} Teacher's profile data or null if not found/error.
 */
export async function getTeacherProfile(uid) {
    if (!uid) {
        console.error("No UID provided to getTeacherProfile");
        return null;
    }
    try {
        const teacherDocRef = doc(db, 'users', uid);
        const teacherDocSnap = await getDoc(teacherDocRef);

        if (teacherDocSnap.exists()) {
            const teacherData = teacherDocSnap.data();
            // Ensure the user has the 'teacher' role
            if (teacherData.role === 'teacher') {
                console.log("Teacher profile loaded:", teacherData);
                return { uid: uid, ...teacherData }; // Return UID along with data
            } else {
                console.warn(`User ${uid} does not have the 'teacher' role.`);
                return null; // Not a teacher
            }
        } else {
            console.warn(`Teacher profile not found for UID: ${uid}`);
            return null;
        }
    } catch (error) {
        console.error("Error fetching teacher profile:", error);
        throw error; // Re-throw for handling in auth.js or dashboard.js
    }
}

/**
 * Fetches students assigned to a specific teacher based on their assignments.
 * @param {object} teacherProfile - The teacher's profile object containing assignment IDs.
 * @returns {Promise<Array<object>>} An array of student data objects.
 */
export async function getAssignedStudents(teacherProfile) {
    if (!teacherProfile || teacherProfile.role !== 'teacher') {
        console.error("Invalid teacher profile provided to getAssignedStudents");
        return []; // Return empty array if no valid teacher profile
    }

    const { assignedCollegeId, assignedDeptId, assignedSectionId } = teacherProfile;

    // --- Build the Firestore query ---
    // Start with the base query for users with the 'student' role
    let q = query(collection(db, 'users'), where("role", "==", "student"));

    // Add filters based on the teacher's assignments
    // IMPORTANT: Firestore requires an index for compound queries.
    // You'll likely need to create indexes in the Firebase console
    // for combinations like (role, collegeId), (role, collegeId, deptId), etc.
    if (assignedCollegeId) {
        q = query(q, where("collegeId", "==", assignedCollegeId));
        console.log(`Filtering by collegeId: ${assignedCollegeId}`);
        if (assignedDeptId) {
            q = query(q, where("deptId", "==", assignedDeptId));
            console.log(`Filtering by deptId: ${assignedDeptId}`);
            if (assignedSectionId) {
                q = query(q, where("sectionId", "==", assignedSectionId));
                console.log(`Filtering by sectionId: ${assignedSectionId}`);
            }
        }
    } else {
        console.warn("Teacher profile missing assignment IDs. Cannot fetch students effectively.");
        return []; // Cannot query without assignments
    }

    // Optional: Order the results
    // q = query(q, orderBy("displayName"));

    console.log("Executing student query...");

    try {
        const querySnapshot = await getDocs(q);
        const students = [];
        querySnapshot.forEach((doc) => {
            students.push({ id: doc.id, ...doc.data() });
        });
        console.log(`Fetched ${students.length} students.`);
        return students;
    } catch (error) {
        console.error("Error fetching assigned students:", error);
        // Check for index errors in the console log
        if (error.code === 'failed-precondition') {
             console.error("Firestore Index Error: Please create the required composite index in your Firebase console.", error.message);
             alert("Error fetching students: Database index required. Please contact administrator.");
        }
        throw error; // Re-throw for handling in dashboard.js
    }
}


/**
 * Fetches session data (resume analyses) for a specific student.
 * @param {string} studentId - The UID of the student.
 * @returns {Promise<Array<object>>} Array of session documents.
 */
export async function getStudentSessions(studentId) {
    if (!studentId) return [];
    try {
        const sessionsRef = collection(db, 'sessions');
        // Query sessions for the specific student, order by start time descending
        const q = query(sessionsRef, where("userId", "==", studentId), orderBy("start_time", "desc"));
        const querySnapshot = await getDocs(q);
        const sessions = [];
        querySnapshot.forEach((doc) => {
            sessions.push({ id: doc.id, ...doc.data() });
        });
        return sessions;
    } catch (error) {
        console.error(`Error fetching sessions for student ${studentId}:`, error);
        throw error;
    }
}

/**
 * Fetches interview data for a specific student.
 * @param {string} studentId - The UID of the student.
 * @returns {Promise<Array<object>>} Array of interview documents.
 */
export async function getStudentInterviews(studentId) {
     if (!studentId) return [];
    try {
        const interviewsRef = collection(db, 'interviews');
        // Query interviews for the specific student, order by start time descending
        const q = query(interviewsRef, where("userId", "==", studentId), orderBy("start_time", "desc"));
        const querySnapshot = await getDocs(q);
        const interviews = [];
        querySnapshot.forEach((doc) => {
            interviews.push({ id: doc.id, ...doc.data() });
        });
        return interviews;
    } catch (error) {
        console.error(`Error fetching interviews for student ${studentId}:`, error);
        throw error;
    }
}

// Add more functions as needed (e.g., get specific session/interview details)

