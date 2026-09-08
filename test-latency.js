// test-latency.js
// Run with: node test-latency.js
// Make sure your backend is running locally first (e.g. npm run dev)

import axios from "axios";

// ---- CONFIG: fill these in ----
const BASE_URL = "http://localhost:3000"; // <-- change to your actual port

const LOGIN_ENDPOINT = "/api/users/login"; // <-- change to your actual login route
const LOGIN_PAYLOAD = {
  email: "mcgibsononyekachukwu@gmail.com", // <-- use a real test account
  password: "mcg430799",
};

// The endpoints you actually want to time
const ENDPOINTS_TO_TEST = [
  {
    name: "Summary Generation",
    method: "post",
    url: "/api/summary/generate-summary/b0a99dbf-e3ac-4199-8615-44437968d9e0", // <-- change to your actual route
    payload: {
      // fill with a real sample payload your endpoint expects
      content: "Sample note content for testing analysis speed.",
    },
  },
  {
    name: "Quiz Generation",
    method: "post",
    url: "/api/quiz/generate-quiz/b0a99dbf-e3ac-4199-8615-44437968d9e0", // <-- change to your actual route
    payload: {
      // fill with a real sample payload your endpoint expects
      code: 'console.log("hello world")',
      language: "javascript",
    },
  },
];

const RUNS_PER_ENDPOINT = 2; // lower this if analysis/execution is slow, to save time

// ---- SCRIPT LOGIC (no need to touch below this line) ----

async function login() {
  try {
    const res = await axios.post(`${BASE_URL}${LOGIN_ENDPOINT}`, LOGIN_PAYLOAD);
    const setCookie = res.headers["set-cookie"]?.find((cookie) =>
      cookie.startsWith("token="),
    );
    if (!setCookie) {
      console.log("Login response shape:", JSON.stringify(res.data, null, 2));
      throw new Error("Could not find the token cookie in the login response.");
    }
    return setCookie.split(";", 1)[0];
  } catch (err) {
    console.error("Login failed:", err.response?.data || err.message);
    process.exit(1);
  }
}

async function testEndpoint(endpoint, token) {
  const times = [];
  const errors = [];

  for (let i = 0; i < RUNS_PER_ENDPOINT; i++) {
    const start = Date.now();
    try {
      await axios({
        method: endpoint.method,
        url: `${BASE_URL}${endpoint.url}`,
        data: endpoint.payload,
        headers: { Cookie: token },
      });
      times.push(Date.now() - start);
    } catch (err) {
      errors.push(err.response?.status || err.message);
    }
  }

  if (times.length === 0) {
    console.log(`\n${endpoint.name}: ALL REQUESTS FAILED`);
    console.log("Errors:", errors);
    return;
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  console.log(`\n${endpoint.name}`);
  console.log(`  Successful runs: ${times.length}/${RUNS_PER_ENDPOINT}`);
  console.log(`  Avg: ${avg.toFixed(0)}ms`);
  console.log(`  Min: ${min}ms`);
  console.log(`  Max: ${max}ms`);
  if (errors.length > 0)
    console.log(
      `  Errors encountered: ${errors.length} (${errors.join(", ")})`,
    );
}

async function main() {
  console.log("Logging in...");
  const token = await login();
  console.log("Login successful. Running tests...\n");

  for (const endpoint of ENDPOINTS_TO_TEST) {
    await testEndpoint(endpoint, token);
  }

  console.log("\nDone. Copy these numbers into your results table.");
}

main();
