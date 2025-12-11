# March Melee Pools (MMPoolsV3)

A modern, real-time sports pool application ("Super Bowl Squares") built for performance, aesthetics, and ease of use. This application allows users to create and manage betting grids with automated scoring, real-time updates, and extensive customization options.

## 🚀 Features

### Core Experience
*   **Interactive 100-Square Grid:** Real-time selection and ownership tracking.
*   **Live Scoreboard:** Automated real-time game scores and quarter tracking via ESPN API.
*   **Mobile-Responsive:** fully optimized design for desktop, tablet, and mobile devices.
*   **User Accounts:** Secure Google Authentication and email registration via Firebase.

### Pool Management
*   **Setup Wizard:** Easy flow to configure teams, costs, and pool rules.
*   **Charity & Fundraising:** ❤️ **NEW!** Dedicate a percentage of the pot to a charity of your choice. Includes automated "Off The Top" calculations and public support badges.
*   **Custom Payouts:** Configurable percentage splits for Q1, Halftime, Q3, and Final scores.
*   **Score Change Payouts:** Optional rule to award fixed amounts on every score change.
*   **Email Notifications:** Automated confirmation emails for square purchases and pool creation via Firebase Trigger Email.
*   **Manager Controls:** Lock/unlock grid, mark squares as paid, manual override options.

### Super Admin Dashboard
*   **System Overview:** View all pools and registered users.
*   **User Management:** Edit user details or delete accounts.
*   **Simulation Mode:** Built-in simulation tool to populate a test pool with random users and simulate a full game with realistic scoring events (viewable at `/#super-admin`).

## 🛠️ Tech Stack

*   **Frontend:** React 19, TypeScript, Vite
*   **Styling:** Tailwind CSS, Lucide React (Icons)
*   **Backend / Data:** Firebase (Firestore, Auth)
*   **APIs:** ESPN (Scoreboard data)
*   **Deployment:** Docker (Nginx serving static assets)

## 💻 Local Developement Setup

1.  **Clone the repository**
    ```bash
    git clone https://github.com/kstruck/MMPoolsV3.git
    cd MMPoolsV3
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Environment Configuration**
    Create a `.env` file in the root directory with your Firebase configuration:
    ```env
    VITE_FIREBASE_API_KEY=your_api_key
    VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    VITE_FIREBASE_PROJECT_ID=your_project_id
    VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
    VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
    VITE_FIREBASE_APP_ID=your_app_id
    ```

4.  **Run Development Server**
    ```bash
    npm run dev
    ```
    The app will actailable at `http://localhost:5173`.

## 🚀 Deployment Guide (Coolify / Docker)

This project is configured for deployment using **Docker**.

### Prerequisites
*   A Coolify instance (or any Docker-based hosting platform).
*   A connected GitHub repository.

### Steps
1.  **Create Service:** In Coolify, add a new resource -> "Git Repository".
2.  **Select Repository:** Choose `kstruck/MMPoolsV3` and the `main` branch.
3.  **Build Pack:** Select **Dockerfile**. The included `Dockerfile` handles the multi-stage build (Vite build -> Nginx serve).
4.  **Environment Variables:** Add your Firebase config variables (same as `.env` above) into the Coolify Secrets/Environment Variables section.
5.  **Expose Port:** Ensure Coolify maps the container's internal Port `80` to your desired domain.
6.  **Deploy:** Click "Deploy".

### Production Notes
*   **Nginx:** The project uses a custom `nginx.conf` to handle client-side routing (SPA fallback to `index.html`).
*   **Caching:** A script in `index.html` automatically unregisters legacy Service Workers to prevent caching issues from older versions of the app.

## 🧪 Simulation Testing (Super Admin)

To test the application flow without waiting for a real game:
1.  Navigate to `YOUR_DOMAIN/#super-admin`.
2.  Locate a pool you want to test.
3.  Click the **RUN SIM** button.
    *   This will auto-fill empty squares with fake users.
    *   Lock the grid and generate numbers.
    *   Simulate a 4-quarter game over ~12 seconds.
