const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let cachedPoToken = null;
let cachedVisitorData = null;
let tokenExpiry = 0;

/**
 * Generate YouTube PO Token and Visitor Data
 * Tokens are valid for ~12 hours, cached to avoid regeneration
 * @returns {Promise<{poToken: string, visitorData: string}>}
 */
async function generatePoToken() {
  const now = Date.now();
  
  // Return cached token if still valid (refresh every 10 hours)
  if (cachedPoToken && cachedVisitorData && now < tokenExpiry) {
    console.log("✅ Using cached PO Token");
    return { poToken: cachedPoToken, visitorData: cachedVisitorData };
  }

  console.log("🔄 Generating new PO Token...");
  
  try {
    const potokenDir = path.join(__dirname, "..", "potoken");
    
    // Check if potoken dependencies are installed
    if (!fs.existsSync(path.join(potokenDir, "node_modules"))) {
      console.log("📦 Installing PO Token generator dependencies...");
      execSync("npm install", { cwd: potokenDir, stdio: "inherit" });
    }

    // Run the generator script
    const output = execSync("node generate.mjs", {
      cwd: potokenDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "inherit"], // stderr to console, stdout to variable
    });

    const result = JSON.parse(output.trim());
    
    if (!result.poToken || !result.visitorData) {
      throw new Error("Failed to generate PO token");
    }

    cachedPoToken = result.poToken;
    cachedVisitorData = result.visitorData;
    tokenExpiry = now + (10 * 60 * 60 * 1000); // 10 hours

    console.log("✅ PO Token generated successfully");
    console.log(`📝 Visitor Data: ${result.visitorData.substring(0, 20)}...`);
    
    return result;
  } catch (error) {
    console.error("❌ Failed to generate PO Token:", error.message);
    throw error;
  }
}

/**
 * Get cached PO Token or generate new one
 * @returns {Promise<{poToken: string, visitorData: string}>}
 */
async function getPoToken() {
  if (!cachedPoToken || !cachedVisitorData || Date.now() >= tokenExpiry) {
    return await generatePoToken();
  }
  return { poToken: cachedPoToken, visitorData: cachedVisitorData };
}

module.exports = { getPoToken, generatePoToken };
