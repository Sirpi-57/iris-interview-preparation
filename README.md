# iris-interview-preparation
IRIS - Interview Readiness &amp; Improvement System


/iris-interview-preparation/
├── backend/
│   └── interview_prep_backend.py   # Flask backend implementation
│
├── frontend/
│   ├── index.html                  # Main HTML structure
│   ├── styles.css                  # Main application styles
│   ├── face-detection-styles.css   # Styles for face detection UI
│   ├── app.js                      # Main application JavaScript
│   ├── face-detection.js           # Face detection implementation
│   │
│   ├── models/                     # (Optional - if not using CDN)
│   │   ├── tiny_face_detector/     # Face detection model files
│   │   ├── face_landmark_68/       # Facial landmark model files
│   │   ├── face_recognition/       # Face recognition model files
│   │   └── face_expression/        # Expression analysis model files
│   │
│   └── assets/                     # (Optional)
│       └── images/                 # UI images, icons, etc.
│
├── .env                            # Environment variables (API keys)
└── README.md                       # Project documentation