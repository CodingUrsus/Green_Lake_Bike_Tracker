import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, collection, addDoc, onSnapshot, query, where, orderBy, serverTimestamp } from 'firebase/firestore';

// Global Firebase configuration and app ID (provided by Canvas environment)
// IMPORTANT: Access these via window object to satisfy ESLint during build
// When running locally (npm start), these window variables will be undefined.
// Provide a fallback configuration for local development.
const firebaseConfig = typeof window.__firebase_config !== 'undefined'
    ? JSON.parse(window.__firebase_config)
    : {
        // --- REPLACE THESE PLACEHOLDER VALUES WITH YOUR ACTUAL FIREBASE PROJECT CONFIG ---
        apiKey: "YOUR_FIREBASE_API_KEY",
        authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
        projectId: "YOUR_PROJECT_ID", // <--- THIS IS CRUCIAL FOR THE ERROR YOU SAW
        storageBucket: "YOUR_PROJECT_ID.appspot.com",
        messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
        appId: "YOUR_APP_ID",
        measurementId: "YOUR_MEASUREMENT_ID" // Optional
        // -------------------------------------------------------------------------------
    };

const appId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'default-app-id';
const initialAuthToken = typeof window.__initial_auth_token !== 'undefined' ? window.__initial_auth_token : null;

// Initialize Firebase outside the component to avoid re-initialization
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Tailwind CSS custom colors based on the provided palette
const customColors = {
    'shuksan-dark-blue': '#5d74a5',
    'shuksan-light-blue': '#b0cbe7',
    'shuksan-cream': '#fff0b4',
    'shuksan-peach': '#eba07e',
    'shuksan-red-brown': '#a45851',
};

// Main App Component
const App = () => {
    const [user, setUser] = useState(null);
    const [userId, setUserId] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authError, setAuthError] = useState('');
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isLeafletLoaded, setIsLeafletLoaded] = useState(false);

    const [isTracking, setIsTracking] = useState(false);
    const [trackingStatus, setTrackingStatus] = useState('Idle');
    const [locationError, setLocationError] = useState('');
    const trackingIntervalRef = useRef(null);

    const mapRef = useRef(null);
    const polylineRef = useRef(null);
    const markerRef = useRef(null);

    const [locationHistory, setLocationHistory] = useState([]);
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [displayStartTime, setDisplayStartTime] = useState('19:00');
    const [displayEndTime, setDisplayEndTime] = useState('21:00');

    // 1. Firebase Authentication and Initialization
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                setUserId(currentUser.uid);
            } else {
                // If no user, try to sign in with custom token or anonymously
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (error) {
                    console.error("Firebase Auth Error:", error);
                    setAuthError("Failed to authenticate. Please try again.");
                }
            }
            setIsAuthReady(true); // Auth state is ready
        });

        return () => unsubscribe();
    }, []);

    // 2. Dynamically Load Leaflet JS and CSS
    useEffect(() => {
        const loadScript = (src, callback) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = callback;
            script.onerror = () => console.error(`Failed to load script: ${src}`);
            document.head.appendChild(script);
        };

        const loadStylesheet = (href) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onerror = () => console.error(`Failed to load stylesheet: ${href}`);
            document.head.appendChild(link);
        };

        loadStylesheet('https://unpkg.com/leaflet@1.7.1/dist/leaflet.css');

        loadScript('https://unpkg.com/leaflet@1.7.1/dist/leaflet.js', () => {
            if (window.L) {
                if (window.L.Icon && window.L.Icon.Default && window.L.Icon.Default.prototype._getIconUrl) {
                    delete window.L.Icon.Default.prototype._getIconUrl;
                    window.L.Icon.Default.mergeOptions({
                        iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
                        iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
                        shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
                    });
                }
                setIsLeafletLoaded(true);
            }
        });
    }, []);

    // 3. Initialize Map (after Leaflet is loaded and Auth is ready)
    useEffect(() => {
        if (isAuthReady && isLeafletLoaded && !mapRef.current && window.L) {
            const map = window.L.map('map').setView([0, 0], 2);
            window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);
            mapRef.current = map;
        }
        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [isAuthReady, isLeafletLoaded]);

    // 4. Fetch and Display Location Data (Real-time from PUBLIC collection)
    useEffect(() => {
        if (!isAuthReady || !mapRef.current) return;

        // Fetch from the public collection for all visitors
        const locationsCollectionRef = collection(db, `artifacts/${appId}/public/data/trackedLocations`);
        const q = query(locationsCollectionRef, orderBy('timestamp', 'asc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const locations = [];
            snapshot.forEach((doc) => {
                locations.push({ id: doc.id, ...doc.data() });
            });
            setLocationHistory(locations);
            console.log("Fetched public location history:", locations.length, "points");
        }, (error) => {
            console.error("Error fetching public location data:", error);
        });

        return () => unsubscribe();
    }, [isAuthReady, mapRef.current]);

    // 5. Update Map with Filtered Data (no change in logic, just dependencies)
    useEffect(() => {
        if (!mapRef.current || !locationHistory.length || !isLeafletLoaded) return;

        const map = mapRef.current;
        const currentDay = new Date(selectedDate);
        currentDay.setHours(0, 0, 0, 0);

        const filteredPoints = locationHistory.filter(point => {
            const pointDate = point.timestamp ? new Date(point.timestamp.toDate()) : null;
            if (!pointDate) return false;

            const isSameDay = pointDate.getFullYear() === currentDay.getFullYear() &&
                              pointDate.getMonth() === currentDay.getMonth() &&
                              pointDate.getDate() === currentDay.getDate();

            if (!isSameDay) return false;

            const [startHour, startMinute] = displayStartTime.split(':').map(Number);
            const [endHour, endMinute] = displayEndTime.split(':').map(Number);

            const pointHour = pointDate.getHours();
            const pointMinute = pointDate.getMinutes();

            const pointTimeInMinutes = pointHour * 60 + pointMinute;
            const startTimeInMinutes = startHour * 60 + startMinute;
            const endTimeInMinutes = endHour * 60 + endMinute;

            if (startTimeInMinutes <= endTimeInMinutes) {
                return pointTimeInMinutes >= startTimeInMinutes && pointTimeInMinutes <= endTimeInMinutes;
            } else {
                return pointTimeInMinutes >= startTimeInMinutes || pointTimeInMinutes <= endTimeInMinutes;
            }
        });

        const latLngs = filteredPoints.map(point => [point.latitude, point.longitude]);

        if (polylineRef.current) {
            map.removeLayer(polylineRef.current);
        }
        if (markerRef.current) {
            map.removeLayer(markerRef.current);
        }

        if (latLngs.length > 0) {
            polylineRef.current = window.L.polyline(latLngs, { color: customColors['shuksan-dark-blue'], weight: 3 }).addTo(map);
            map.fitBounds(polylineRef.current.getBounds());

            const lastPoint = latLngs[latLngs.length - 1];
            markerRef.current = window.L.marker(lastPoint).addTo(map)
                .bindPopup(`Last known location: ${new Date(filteredPoints[filteredPoints.length - 1].timestamp.toDate()).toLocaleTimeString()}`)
                .openPopup();
        } else {
            map.setView([0, 0], 2);
        }
    }, [locationHistory, selectedDate, displayStartTime, displayEndTime, isLeafletLoaded]);


    // 6. Location Tracking Logic (Foreground Only - remains user-exclusive)
    const startTracking = () => {
        if (!userId) { // This check is crucial for exclusivity
            setLocationError("Please log in to start tracking.");
            return;
        }

        if (!navigator.geolocation) {
            setLocationError("Geolocation is not supported by your browser.");
            return;
        }

        setTrackingStatus('Requesting permission...');
        setLocationError('');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                setTrackingStatus('Tracking...');
                setIsTracking(true);
                saveLocation(position);

                trackingIntervalRef.current = setInterval(() => {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => saveLocation(pos),
                        (err) => {
                            console.error("Geolocation error during interval:", err.message, err);
                            if (err.message && err.message.includes("permissions policy")) {
                                setLocationError("Geolocation is disabled in this environment due to browser/iframe permissions policy. Real-time tracking is not possible here.");
                            } else {
                                setLocationError(`Geolocation error: ${err.message}`);
                            }
                        },
                        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                    );
                }, 60 * 1000);
            },
            (error) => {
                console.error("Geolocation permission denied or error:", error.message, error);
                if (error.message && error.message.includes("permissions policy")) {
                    setLocationError("Geolocation is disabled in this environment due to browser/iframe permissions policy. Real-time tracking is not possible here.");
                } else {
                    setLocationError(`Geolocation error: ${error.message}. Please enable location services.`);
                }
                setTrackingStatus('Idle');
                setIsTracking(false);
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    };

    const stopTracking = () => {
        if (trackingIntervalRef.current) {
            clearInterval(trackingIntervalRef.current);
            trackingIntervalRef.current = null;
        }
        setIsTracking(false);
        setTrackingStatus('Idle');
        setLocationError('');
    };

    const saveLocation = async (position) => {
        if (!userId) {
            console.error("Cannot save location: User not authenticated.");
            return;
        }

        const { latitude, longitude, accuracy, altitude } = position.coords;
        const locationData = {
            timestamp: serverTimestamp(),
            latitude,
            longitude,
            accuracy: accuracy || null,
            altitude: altitude || null,
            // We still include userId to identify the tracker, even if data is public
            trackerUserId: userId
        };

        try {
            // Save to the public collection
            const locationsCollectionRef = collection(db, `artifacts/${appId}/public/data/trackedLocations`);
            await addDoc(locationsCollectionRef, locationData);
            console.log("Location saved to public collection:", locationData);
        } catch (e) {
            console.error("Error adding document to public collection: ", e);
            setLocationError("Failed to save location data.");
        }
    };

    // Authentication Handlers
    const handleSignUp = async () => {
        setAuthError('');
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            setEmail('');
            setPassword('');
        } catch (error) {
            setAuthError(error.message);
        }
    };

    const handleSignIn = async () => {
        setAuthError('');
        try {
            await signInWithEmailAndPassword(auth, email, password);
            setEmail('');
            setPassword('');
        } catch (error) {
            setAuthError(error.message);
        }
    };

    const handleSignOut = async () => {
        setAuthError('');
        try {
            await signOut(auth);
            stopTracking(); // Stop tracking if user signs out
            // Do NOT clear locationHistory here, as it's now public data
        } catch (error) {
            setAuthError(error.message);
        }
    };

    // Show loading screen until Firebase Auth and Leaflet are ready
    if (!isAuthReady || !isLeafletLoaded) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-[#fff0b4]">
                <div className="text-xl font-semibold text-[#5d74a5]">Loading application...</div>
            </div>
        );
    }

    // Main App Content (unified layout)
    return (
        <div className="min-h-screen flex flex-col font-sans bg-[#fff0b4] text-gray-800">
            {/* Header */}
            <header className="bg-gradient-to-r from-[#5d74a5] to-[#b0cbe7] text-white p-4 shadow-md rounded-b-lg">
                <h1 className="text-3xl font-bold text-center">My Location Tracker</h1>
            </header>

            {/* Main Content Area */}
            <main className="flex-grow p-6 flex flex-col lg:flex-row gap-6">
                {/* Left Panel: Auth & Controls */}
                <div className="bg-white p-6 rounded-xl shadow-lg lg:w-1/3 flex flex-col space-y-6">
                    {/* User Authentication / Login Form */}
                    <section className="border-b pb-4 mb-4 border-gray-200">
                        <h2 className="text-2xl font-semibold text-[#5d74a5] mb-4">
                            {user ? 'Account' : 'Sign In / Sign Up'}
                        </h2>
                        {user ? (
                            <div>
                                <p className="text-lg mb-2">Welcome, <span className="font-medium text-[#5d74a5]">{user.email || `User ID: ${userId}`}</span>!</p>
                                <p className="text-sm text-gray-600 mb-4">Your User ID: <span className="font-mono bg-[#b0cbe7] p-1 rounded text-xs">{userId}</span></p>
                                <button
                                    onClick={handleSignOut}
                                    className="w-full bg-[#a45851] hover:bg-[#eba07e] text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105"
                                >
                                    Sign Out
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <input
                                    type="email"
                                    placeholder="Email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#b0cbe7] focus:border-transparent transition duration-200"
                                />
                                <input
                                    type="password"
                                    placeholder="Password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#b0cbe7] focus:border-transparent transition duration-200"
                                />
                                <div className="flex flex-col space-y-3">
                                    <button
                                        onClick={handleSignIn}
                                        className="w-full bg-[#5d74a5] hover:bg-[#b0cbe7] text-white font-bold py-3 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105"
                                    >
                                        Sign In
                                    </button>
                                    <button
                                        onClick={handleSignUp}
                                        className="w-full bg-[#eba07e] hover:bg-[#a45851] text-white font-bold py-3 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105"
                                    >
                                        Sign Up
                                    </button>
                                </div>
                                {authError && <p className="text-red-500 text-sm mt-4 text-center">{authError}</p>}
                            </div>
                        )}
                    </section>

                    {/* Location Tracking Controls (ONLY visible and functional for logged-in user) */}
                    {user && ( // Only render this section if a user is logged in
                        <section className="border-b pb-4 mb-4 border-gray-200">
                            <h2 className="text-2xl font-semibold text-[#5d74a5] mb-4">Live Tracking</h2>
                            <p className="text-lg mb-2">Status: <span className={`font-bold ${isTracking ? 'text-green-600' : 'text-gray-500'}`}>{trackingStatus}</span></p>
                            <div className="flex space-x-4 mb-4">
                                <button
                                    onClick={startTracking}
                                    disabled={isTracking}
                                    className={`flex-1 font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out ${isTracking ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#5d74a5] hover:bg-[#b0cbe7] text-white transform hover:scale-105'}`}
                                >
                                    Start Tracking
                                </button>
                                <button
                                    onClick={stopTracking}
                                    disabled={!isTracking}
                                    className={`flex-1 font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out ${!isTracking ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#a45851] hover:bg-[#eba07e] text-white transform hover:scale-105'}`}
                                >
                                    Stop Tracking
                                </button>
                            </div>
                            {locationError && <p className="text-red-500 text-sm mt-2">{locationError}</p>}
                            <p className="text-sm text-gray-600 italic">
                                Note: Tracking only works when this page is open and active in your browser.
                                Also, geolocation might be disabled in this specific environment due to browser/iframe security policies.
                            </p>
                        </section>
                    )}
                    {!user && ( // Message for non-logged-in users about tracking
                        <section className="border-b pb-4 mb-4 border-gray-200">
                            <h2 className="text-2xl font-semibold text-[#5d74a5] mb-4">Live Tracking</h2>
                            <p className="text-gray-600 italic">
                                Only Austin can start and stop location tracking.
                            </p>
                        </section>
                    )}


                    {/* Display Filters (Visible to all visitors) */}
                    <section>
                        <h2 className="text-2xl font-semibold text-[#5d74a5] mb-4">Display Filters</h2>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="selectedDate" className="block text-[#5d74a5] text-sm font-bold mb-2">
                                    Select Date:
                                </label>
                                <input
                                    type="date"
                                    id="selectedDate"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#b0cbe7] focus:border-transparent transition duration-200"
                                />
                            </div>
                            <div>
                                <label htmlFor="displayStartTime" className="block text-[#5d74a5] text-sm font-bold mb-2">
                                    Display Start Time:
                                </label>
                                <input
                                    type="time"
                                    id="displayStartTime"
                                    value={displayStartTime}
                                    onChange={(e) => setDisplayStartTime(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#b0cbe7] focus:border-transparent transition duration-200"
                                />
                            </div>
                            <div>
                                <label htmlFor="displayEndTime" className="block text-[#5d74a5] text-sm font-bold mb-2">
                                    Display End Time:
                                </label>
                                <input
                                    type="time"
                                    id="displayEndTime"
                                    value={displayEndTime}
                                    onChange={(e) => setDisplayEndTime(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#b0cbe7] focus:border-transparent transition duration-200"
                                />
                            </div>
                        </div>
                    </section>
                </div>

                {/* Right Panel: Map Display (Visible to all visitors) */}
                <div className="bg-white p-6 rounded-xl shadow-lg flex-grow lg:w-2/3">
                    <h2 className="text-2xl font-semibold text-[#5d74a5] mb-4">Location Map</h2>
                    <div id="map" className="w-full h-96 rounded-lg shadow-inner border border-gray-200"></div>
                    {locationHistory.length === 0 && (
                        <p className="text-center text-gray-500 mt-4">No location data available for the selected filters. The tracker needs to be logged in and start tracking.</p>
                    )}
                </div>
            </main>

            {/* Footer */}
            <footer className="bg-[#5d74a5] text-white p-4 text-center text-sm rounded-t-lg mt-6">
                <p>&copy; {new Date().getFullYear()} My Location Tracker. All rights reserved.</p>
                <p>Powered by React, Tailwind CSS, Leaflet, and Firebase.</p>
            </footer>
        </div>
    );
};

export default App;
