import { Server, Socket } from "socket.io";
import express from "express";
import http from "http";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CLIENT_URL ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));

const io = new Server(server, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
});

interface User { socketId: string; }

let waitingUser: User | null = null;
const userPairs: Record<string, string> = {};

const matchUser = (socket: Socket | undefined) => {
    if (!socket || socket.disconnected) return;

    if (waitingUser !== null) {
        if (waitingUser.socketId === socket.id) return;

        const waitingSocket = io.sockets.sockets.get(waitingUser.socketId);
        if (!waitingSocket || waitingSocket.disconnected) {
            waitingUser = null;
            return matchUser(socket);
        }

        userPairs[socket.id] = waitingUser.socketId;
        userPairs[waitingUser.socketId] = socket.id;

        // Only the newly matched socket starts the offer. This prevents glare
        // (both peers creating an offer at the same time).
        socket.emit("user:connect", waitingUser.socketId);
        waitingUser = null;
        return;
    }

    waitingUser = { socketId: socket.id };
};

io.on("connection", (socket) => {
    matchUser(socket);

    socket.on("offer", ({ offer, to }) => {
        if (typeof to === "string" && userPairs[socket.id] === to) {
            io.to(to).emit("offer", { offer, from: socket.id });
        }
    });

    socket.on("answer", ({ answer, to }) => {
        if (typeof to === "string" && userPairs[socket.id] === to) {
            io.to(to).emit("answer", { answer, from: socket.id });
        }
    });

    socket.on("peer:nego:needed", ({ offer, to }) => {
        if (typeof to === "string" && userPairs[socket.id] === to) {
            io.to(to).emit("peer:nego:needed", { offer, from: socket.id });
        }
    });

    socket.on("peer:nego:done", ({ answer, to }) => {
        if (typeof to === "string" && userPairs[socket.id] === to) {
            io.to(to).emit("peer:nego:final", { answer, to: socket.id });
        }
    });

    socket.on("ice-candidate", ({ candidate, to }) => {
        if (typeof to === "string" && userPairs[socket.id] === to) {
            io.to(to).emit("ice-candidate", { candidate });
        }
    });

    socket.on("send:message", ({ message, to }) => {
        if (typeof to === "string" && userPairs[socket.id] === to) {
            io.to(to).emit("message:recieved", { message, from: socket.id });
        }
    });

    socket.on("skip", () => {
        const partnerId = userPairs[socket.id];

        if (partnerId) {
            io.to(partnerId).emit("skipped");
            delete userPairs[socket.id];
            delete userPairs[partnerId];
            matchUser(io.sockets.sockets.get(partnerId));
        }

        matchUser(socket);
    });

    socket.on("disconnect", () => {
        const partnerId = userPairs[socket.id];

        if (partnerId) {
            io.to(partnerId).emit("partnerDisconnected");
            delete userPairs[socket.id];
            delete userPairs[partnerId];
            matchUser(io.sockets.sockets.get(partnerId));
        }

        if (waitingUser?.socketId === socket.id) waitingUser = null;
    });
});

app.get("/", (_req, res) => res.send("SchoolMeet server is running"));

const PORT = Number(process.env.PORT) || 8000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
