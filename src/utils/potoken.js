const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let cachedPoToken = null;
let cachedVisitorData = null;
let tokenExpiry = 0;

/**
 * Run a command and return output
 * @param {string} command 
 * @param {string[]} args 
 * @param {object} options 
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    if (proc.stdout) {
      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }

    if (proc.stderr) {
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
        // Log stderr in real-time for progress
        if (options.logStderr !== false) {
          process.stderr.write(data);
        }
      });
    }

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}\n${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

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
    const potokenDir = path.join(__dirname, "..", "..", "potoken");
    
    // Check if potoken dependencies are installed
    if (!fs.existsSync(path.join(potokenDir, "node_modules"))) {
      console.log("📦 Installing PO Token generator dependencies...");
      await runCommand("npm", ["install"], { cwd: potokenDir });
    }

    // Run the generator script
    console.error("🔧 Running PO Token generator...");
    const output = await runCommand("node", ["generate.mjs"], { 
      cwd: potokenDir,
      logStderr: true,
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
