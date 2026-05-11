require("dotenv").config();

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const config = require("../config.json");

const children = [];

const COLORS = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	black: "\x1b[30m",
	white: "\x1b[97m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
	bgRed: "\x1b[41m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
	bgBlue: "\x1b[44m",
	bgMagenta: "\x1b[45m",
	bgCyan: "\x1b[46m",
	bgGray: "\x1b[100m",
};

const LEVELS = {
	info: { label: "INFO", fg: COLORS.white, bg: COLORS.bgBlue },
	ok: { label: "OK", fg: COLORS.white, bg: COLORS.bgGreen },
	warn: { label: "WARN", fg: COLORS.white, bg: COLORS.bgYellow },
	error: { label: "ERROR", fg: COLORS.white, bg: COLORS.bgRed },
	exit: { label: "EXIT", fg: COLORS.white, bg: COLORS.bgMagenta },
};

const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== "1";
const colorize = (color, text) =>
	useColor ? `${color}${text}${COLORS.reset}` : text;
const timestamp = () =>
	new Date().toISOString().replace("T", " ").replace("Z", "");

const box = (text, fg, bg) =>
	useColor ? `${bg}${fg}${COLORS.bold} ${text} ${COLORS.reset}` : text;

const hashLabel = (label) => {
	let hash = 0;
	for (let i = 0; i < label.length; i += 1) {
		hash = (hash * 31 + label.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
};

const labelStyle = (label) => {
	if (label === "dev") return { fg: COLORS.white, bg: COLORS.bgGray };
	if (label === "main-bot") return { fg: COLORS.white, bg: COLORS.bgGreen };
	const palette = [
		{ fg: COLORS.white, bg: COLORS.bgBlue },
		{ fg: COLORS.white, bg: COLORS.bgMagenta },
		{ fg: COLORS.white, bg: COLORS.bgCyan },
		{ fg: COLORS.white, bg: COLORS.bgYellow },
		{ fg: COLORS.white, bg: COLORS.bgRed },
	];
	return palette[hashLabel(label) % palette.length];
};

const formatLabel = (label) => {
	if (!label) return "";
	if (useColor && label.includes("\x1b[")) return label;
	const style = labelStyle(label);
	return box(label, style.fg, style.bg);
};

const LOG_DIR = path.join(__dirname, "..", "logs");
if (!fs.existsSync(LOG_DIR)) {
	fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logStreams = new Map();

const logFileNameForLabel = (label) => {
	if (label === "main-bot") return "instance-main-log.txt";
	const match = /^instance-(\d+)/.exec(label || "");
	if (match) return `instance-${match[1]}-log.txt`;
	return null;
};

const ensureLogStream = (label) => {
	const fileName = logFileNameForLabel(label);
	if (!fileName) return;
	if (logStreams.has(label)) return;
	const filePath = path.join(LOG_DIR, fileName);
	const stream = fs.createWriteStream(filePath, { flags: "a" });
	logStreams.set(label, stream);
};

const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, "");

const formatLine = (level, label, message, colored) => {
	const meta = LEVELS[level] || LEVELS.info;
	const time = colored ? colorize(COLORS.dim, timestamp()) : timestamp();
	const lvl = colored ? box(meta.label, meta.fg, meta.bg) : meta.label.padEnd(5, " ");
	const scope = label
		? colored
			? formatLabel(label)
			: label
		: "";
	return [time, lvl, scope, message].filter(Boolean).join(" ");
};

const writeLog = (label, line) => {
	const stream = logStreams.get(label);
	if (!stream) return;
	stream.write(stripAnsi(line) + "\n");
};

const log = (level, label, message) => {
	ensureLogStream(label);
	const line = formatLine(level, label, message, true);
	console.log(line);
	const plain = formatLine(level, label, message, false);
	writeLog(label, plain);
};

const createLineParser = (onLine) => {
	let buffer = "";
	return (chunk) => {
		buffer += chunk.toString();
		const parts = buffer.split(/\r?\n/);
		buffer = parts.pop() || "";
		for (const line of parts) {
			onLine(line);
		}
	};
};

const startProcess = (label, script, args = []) => {
	ensureLogStream(label);
	log("info", label, `Starting ${script}${args.length ? " " + args.join(" ") : ""}`);
	const child = spawn(process.execPath, [script, ...args], {
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, RUNTIME_LOGGER_DISABLED: "1" },
	});

	const stdoutParser = createLineParser((line) => log("info", label, line));
	const stderrParser = createLineParser((line) => log("error", label, line));

	if (child.stdout) {
		child.stdout.on("data", stdoutParser);
	}

	if (child.stderr) {
		child.stderr.on("data", stderrParser);
	}

	child.on("error", (error) => {
		const message = error && error.message ? error.message : String(error);
		log("error", label, message);
	});

	child.on("exit", (code, signal) => {
		const exitCode = typeof code === "number" ? code : "null";
		const exitSignal = signal || "null";
		log("exit", label, `Exited (code=${exitCode}, signal=${exitSignal})`);
	});

	children.push(child);
	return child;
};

const shutdown = () => {
	log("warn", "dev", "Shutting down child processes");
	for (const child of children) {
		if (!child.killed) {
			child.kill();
		}
	}
	for (const stream of logStreams.values()) {
		stream.end();
	}
};

const mainPath = path.join(__dirname, "index.js");
startProcess("main-bot", mainPath);

const instances = Array.isArray(config.instances) ? config.instances : [];
const instancePath = path.join(__dirname, "instances.js");

log("info", "dev", `Launching ${instances.length} instance(s)`);

const BOX_COLORS = [COLORS.cyan, COLORS.magenta, COLORS.yellow];
const boxColor = (index) => BOX_COLORS[index % BOX_COLORS.length];

const buildBox = (title, vcName, port, index) => {
	const lines = [
		`Instance ${title}`,
		`vc   - ${vcName}`,
		`port - ${port}`,
	];

	const width = Math.max(...lines.map((line) => line.length));
	const border = `+${"=".repeat(width + 2)}+`;
	const body = lines.map((line) => `| ${line.padEnd(width, " ")} |`);
	return {
		color: boxColor(index),
		width,
		lines: [border, ...body, border],
	};
};

const renderBoxLine = (line, color) => {
	if (!useColor) return line;
	if (line.startsWith("+")) {
		return colorize(color, line);
	}
	const left = colorize(color, "|");
	const right = colorize(color, "|");
	return `${left}${line.slice(1, -1)}${right}`;
};

const renderBoxesRow = (boxes) => {
	const height = Math.max(...boxes.map((box) => box.lines.length));
	for (let i = 0; i < height; i += 1) {
		const row = boxes
			.map((box) => renderBoxLine(box.lines[i] || "", box.color))
			.join("  ");
		console.log(row);
	}
};

const BOXES_PER_ROW = 3;
const boxes = instances.map((instance, i) => {
	const name = instance?.name || `instance-${i + 1}`;
	const port = instance?.apiPort ?? "-";
	return buildBox(i + 1, name, port, i);
});

for (let i = 0; i < boxes.length; i += BOXES_PER_ROW) {
	renderBoxesRow(boxes.slice(i, i + BOXES_PER_ROW));
}

instances.forEach((_, i) => {
	startProcess(`instance-${i + 1}`, instancePath, [String(i + 1)]);
});

process.on("SIGINT", () => {
	shutdown();
	process.exit(0);
});

process.on("SIGTERM", () => {
	shutdown();
	process.exit(0);
});

process.on("exit", () => {
	shutdown();
});
