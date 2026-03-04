// chess.js
import express from "express";
import http from "http";
import mongoose from "mongoose";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { Chess } from "chess.js";

/* ================== EXPRESS SETUP ================== */
const app = express();
const server = http.createServer(app);

/* ================== CORS ================== */
const corsOptions = {
  origin: "https://chessplatform.netlify.app", // your frontend
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

/* ================== SOCKET.IO ================== */
const io = new Server(server, { cors: corsOptions });

/* ================== DATABASE ================== */
mongoose.connect("mongodb+srv://admin:admin123@cluster0.uhfubqa.mongodb.net")
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error(err));

/* ================== USER SCHEMA ================== */
const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  elo: { type: Number, default: 1000 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  draws: { type: Number, default: 0 },
});
const User = mongoose.model("User", userSchema);

/* ================== AUTH ================== */
function verifyToken(token) {
  return jwt.verify(token, "secret123");
}

/* ================== REGISTER ================== */
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, password: hashed });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ================== LOGIN ================== */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json("User not found");

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json("Wrong password");

    const token = jwt.sign({ id: user._id }, "secret123");
    res.json({ token, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ================== ELO CALCULATION ================== */
function calculateElo(player, opponent, score, k = 32) {
  const expected = 1 / (1 + Math.pow(10, (opponent - player) / 400));
  return Math.round(player + k * (score - expected));
}

async function updateRatings(winnerId, loserId, draw = false) {
  const winner = await User.findById(winnerId);
  const loser = await User.findById(loserId);
  if (!winner || !loser) return;

  if (draw) {
    winner.elo = calculateElo(winner.elo, loser.elo, 0.5);
    loser.elo = calculateElo(loser.elo, winner.elo, 0.5);
    winner.draws++;
    loser.draws++;
  } else {
    winner.elo = calculateElo(winner.elo, loser.elo, 1);
    loser.elo = calculateElo(loser.elo, winner.elo, 0);
    winner.wins++;
    loser.losses++;
  }

  await winner.save();
  await loser.save();
  return { winner, loser };
}

/* ================== GAME STORAGE ================== */
let games = {};
let queue = [];

const squareMap = [
  "a8","b8","c8","d8","e8","f8","g8","h8",
  "a7","b7","c7","d7","e7","f7","g7","h7",
  "a6","b6","c6","d6","e6","f6","g6","h6",
  "a5","b5","c5","d5","e5","f5","g5","h5",
  "a4","b4","c4","d4","e4","f4","g4","h4",
  "a3","b3","c3","d3","e3","f3","g3","h3",
  "a2","b2","c2","d2","e2","f2","g2","h2",
  "a1","b1","c1","d1","e1","f1","g1","h1"
];
const indexToSquare = (i) => squareMap[i];

/* ================== SOCKET AUTH ================== */
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token"));
    const decoded = verifyToken(token);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

/* ================== SOCKET EVENTS ================== */
io.on("connection", (socket) => {

  // MATCHMAKING
  socket.on("joinMatchmaking", () => {
    if (!queue.find(s => s.id === socket.id)) queue.push(socket);

    if (queue.length >= 2) {
      const p1 = queue.shift();
      const p2 = queue.shift();
      const roomId = "room_" + Date.now();

      p1.join(roomId);
      p2.join(roomId);

      games[roomId] = {
        chess: new Chess(),
        players: { white: p1.userId, black: p2.userId },
        rematchVotes: new Set()
      };

      p1.emit("matchFound", { roomId, color: "w" });
      p2.emit("matchFound", { roomId, color: "b" });
    }
  });

  // AI GAME
  socket.on("startAIGame", () => {
    const roomId = "ai_" + Date.now();
    socket.join(roomId);
    games[roomId] = { chess: new Chess(), ai: true };
    socket.emit("matchFound", { roomId, color: "w" });
  });

  // LEGAL MOVES
  socket.on("getLegalMoves", ({ roomId, fromIndex }) => {
    const gameObj = games[roomId];
    if (!gameObj) return;
    const square = indexToSquare(fromIndex);
    const moves = gameObj.chess.moves({ square, verbose: true });
    socket.emit("legalMoves", moves.map(m => m.to));
  });

  // CHESS MOVE
  socket.on("chessMove", async ({ roomId, move }) => {
    const gameObj = games[roomId];
    if (!gameObj) return;
    const chess = gameObj.chess;
    const result = chess.move({ from: indexToSquare(move.from), to: indexToSquare(move.to), promotion: "q" });
    if (!result) return socket.emit("illegalMove");

    io.to(roomId).emit("chessUpdate", { fen: chess.fen(), turn: chess.turn() });
    if (chess.isCheck() && !chess.isCheckmate()) io.to(roomId).emit("check", { color: chess.turn() });

    // GAME OVER
    if (chess.isGameOver()) {
      if (!gameObj.ai) {
        const { white, black } = gameObj.players;
        if (chess.isDraw()) await updateRatings(white, black, true);
        if (chess.isCheckmate()) {
          const winnerColor = chess.turn() === "w" ? "b" : "w";
          const winnerId = winnerColor === "w" ? white : black;
          const loserId = winnerId === white ? black : white;
          await updateRatings(winnerId, loserId);
        }
      }

      io.to(roomId).emit("gameOver", {
        result: chess.isDraw() ? "draw" : "win",
        winner: chess.isCheckmate() ? (chess.turn() === "w" ? "b" : "w") : null
      });
      return;
    }

    // AI MOVE
    if (gameObj.ai) {
      setTimeout(() => {
        const moves = chess.moves({ verbose: true });
        if (!moves.length) return;
        const aiMove = moves[Math.floor(Math.random() * moves.length)];
        chess.move(aiMove);
        io.to(roomId).emit("chessUpdate", { fen: chess.fen(), turn: chess.turn() });

        if (chess.isGameOver()) {
          io.to(roomId).emit("gameOver", {
            result: chess.isDraw() ? "draw" : "win",
            winner: chess.turn() === "w" ? "b" : "w"
          });
        }
      }, 600);
    }
  });

  // REMATCH
  socket.on("requestRematch", ({ roomId }) => {
    const gameObj = games[roomId];
    if (!gameObj) return;
    if (gameObj.ai) {
      gameObj.chess = new Chess();
      io.to(roomId).emit("rematchStarted", { fen: gameObj.chess.fen(), turn: gameObj.chess.turn() });
      return;
    }
    gameObj.rematchVotes.add(socket.userId);
    const players = Object.values(gameObj.players);
    if (players.every(id => gameObj.rematchVotes.has(id))) {
      gameObj.chess = new Chess();
      gameObj.rematchVotes.clear();
      io.to(roomId).emit("rematchStarted", { fen: gameObj.chess.fen(), turn: gameObj.chess.turn() });
    }
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    queue = queue.filter(s => s.id !== socket.id);
    for (let roomId in games) {
      const game = games[roomId];
      if (!game.players) continue;
      if (Object.values(game.players).includes(socket.userId)) {
        delete games[roomId];
        io.to(roomId).emit("gameOver", { result: "draw" });
      }
    }
  });
});

/* ================== START SERVER ================== */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
