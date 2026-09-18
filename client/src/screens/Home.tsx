import { useCallback } from "react";
import { Button } from "../components/ui/button";
import { useSocket } from "../context/SocketProvider";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import LogoContent from "../components/LogoContent";
import { Helmet } from "react-helmet-async";

export default function Home() {
  const { socket, setSocket } = useSocket();
  const navigate = useNavigate();

  const handleStartCall = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (!socket) {
        const newSocket = io(import.meta.env.VITE_API_SERVER_URL, {
          // Prefer HTTPS long-polling first. This works through more
          // restrictive networks while still allowing a WebSocket upgrade.
          transports: ["polling", "websocket"],
          upgrade: true,
          reconnection: true,
          reconnectionAttempts: 10,
          timeout: 10000,
        });

        newSocket.on("connect_error", (error) => {
          console.error("SchoolMeet server connection failed:", error.message);
        });

        setSocket(newSocket);
      }
      navigate("/chat");
    },
    [setSocket, socket, navigate]
  );

  return (
    <>
      <Helmet>
        <title>SchoolMeet - Connect, Chat, Collaborate</title>
        <meta name="description" content="SchoolMeet is a real-time video chat application for connecting, chatting, collaborating, sharing screens, and exchanging messages." />
        <meta name="keywords" content="SchoolMeet, video chat, random chat, video call, screen sharing, real-time messaging" />
      </Helmet>
      <main className="flex flex-col justify-center h-full mx-auto w-full p-4 lg:p-8">
        <div className="w-full flex flex-col lg:flex-row justify-center items-center lg:justify-evenly mx-auto">
          <div className="flex flex-col items-center justify-center text-center mb-6 lg:mb-0 w-full lg:w-auto">
            <div className="flex items-end gap-4 mb-6">
              <svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="1508.204676pt" height="836.077412pt" viewBox="0 0 1508.204676 836.077412" preserveAspectRatio="xMidYMid meet" className="h-auto w-[150px] sm:w-[180px] md:w-[200px] text-black dark:text-white">
                <LogoContent />
              </svg>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold font-serif mb-2">SchoolMeet</h1>
            <p className="text-base sm:text-lg md:text-xl mb-4 sm:mb-6">Connect. Chat. Collaborate.</p>
          </div>

          <div className="bg-gradient-to-r from-teal-500 to-blue-600 shadow-xl rounded-3xl p-6 md:p-8 w-full lg:w-[60%] mx-0 backdrop-blur-lg bg-opacity-60 border border-teal-300">
            <p className="text-sm sm:text-base md:text-lg mb-6 md:mb-8 leading-relaxed text-gray-200">
              SchoolMeet makes it easy to connect with another user through live video,
              audio, screen sharing, and real-time messaging. The app is designed for
              fast, direct peer-to-peer communication with a simple interface.
            </p>

            <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-6 md:mb-8">
              <Button
                className="w-full sm:w-auto py-3 sm:py-4 text-base sm:text-lg font-semibold tracking-wider shadow-lg transition-transform duration-300 hover:scale-105 bg-gradient-to-r from-teal-500 to-teal-700 hover:from-teal-600 hover:to-teal-800 rounded-xl"
                onClick={handleStartCall}
              >
                Start Your Journey
              </Button>
            </div>

            <div className="text-xs sm:text-sm text-center mt-4 text-teal-100">
              By using SchoolMeet, you agree to the applicable Terms of Service and Privacy Policy.
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
