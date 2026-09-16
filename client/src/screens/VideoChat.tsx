import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "../context/SocketProvider";
import peerservice from "../service/peer";
import { Button } from "../components/ui/button";
import Messages from "../components/Messages";
import { ScreenShare, StepBack, StepForward } from "lucide-react";
import { ClipLoader } from "react-spinners";
import { useTheme } from "../components/theme-provider";
import { useNavigate } from "react-router-dom";
import "../css/VideoChat.css";

interface Offer {
  offer: RTCSessionDescriptionInit;
  from: string;
}

interface Answer {
  answer: RTCSessionDescriptionInit;
  from: string;
}

interface NegotiationDone {
  answer: RTCSessionDescriptionInit;
  to: string;
}

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640, max: 1280 },
  height: { ideal: 480, max: 720 },
  frameRate: { ideal: 24, max: 30 },
};

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

export default function VideoChat() {
  const { socket } = useSocket();
  const navigate = useNavigate();
  const theme = useTheme();

  const [remoteSocketId, setRemoteSocketId] = useState<string | null>(null);
  const [myStream, setMyStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [messagesArray, setMessagesArray] = useState<Array<{ sender: string; message: string }>>([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteIdRef = useRef<string | null>(null);
  const negotiatingRef = useRef(false);
  const makingOfferRef = useRef(false);

  const loaderColor = theme.theme === "dark" ? "#D1D5DB" : "#4B5563";

  const setRemoteId = useCallback((id: string | null) => {
    remoteIdRef.current = id;
    setRemoteSocketId(id);
  }, []);

  const attachLocalStream = useCallback((stream: MediaStream | null) => {
    localStreamRef.current = stream;
    setMyStream(stream);
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
  }, []);

  const getUserStream = useCallback(async () => {
    if (localStreamRef.current?.active) return localStreamRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: VIDEO_CONSTRAINTS,
      audio: AUDIO_CONSTRAINTS,
    });
    attachLocalStream(stream);
    return stream;
  }, [attachLocalStream]);

  const addLocalTracks = useCallback(async () => {
    const stream = await getUserStream();
    const peer = peerservice.peer;

    for (const track of stream.getTracks()) {
      const existing = peer.getSenders().find((sender) => sender.track?.kind === track.kind);
      if (!existing) peer.addTrack(track, stream);
      else if (existing.track !== track) await existing.replaceTrack(track);
    }
  }, [getUserStream]);

  const setSenderBitrates = useCallback(() => {
    for (const sender of peerservice.peer.getSenders()) {
      if (!sender.track) continue;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];

      if (sender.track.kind === "video") {
        parameters.encodings[0].maxBitrate = 1_200_000;
        parameters.encodings[0].maxFramerate = 30;
        parameters.encodings[0].scaleResolutionDownBy = 1;
      } else if (sender.track.kind === "audio") {
        parameters.encodings[0].maxBitrate = 64_000;
      }

      sender.setParameters(parameters).catch(() => undefined);
    }
  }, []);

  const createOfferAndSend = useCallback(async (eventName: "offer" | "peer:nego:needed") => {
    const target = remoteIdRef.current;
    if (!socket || !target || makingOfferRef.current || peerservice.peer.signalingState !== "stable") return;

    makingOfferRef.current = true;
    try {
      await addLocalTracks();
      const offer = await peerservice.getOffer();
      setSenderBitrates();
      if (offer) socket.emit(eventName, { offer, to: target });
    } catch (error) {
      console.error("Failed to create WebRTC offer:", error);
    } finally {
      makingOfferRef.current = false;
    }
  }, [addLocalTracks, setSenderBitrates, socket]);

  const resetPeer = useCallback(() => {
    if (peerservice.peer.signalingState !== "closed") peerservice.peer.close();
    peerservice.initPeer();
    negotiatingRef.current = false;
    makingOfferRef.current = false;
  }, []);

  const handleUserJoined = useCallback(async (remoteId: string) => {
    setRemoteId(remoteId);
    await createOfferAndSend("offer");
  }, [createOfferAndSend, setRemoteId]);

  const handleIncomingOffer = useCallback(async ({ offer, from }: Offer) => {
    setRemoteId(from);
    try {
      if (peerservice.peer.signalingState !== "stable") resetPeer();
      await addLocalTracks();
      const answer = await peerservice.getAnswer(offer);
      setSenderBitrates();
      if (socket && answer) socket.emit("answer", { answer, to: from });
    } catch (error) {
      console.error("Failed to handle WebRTC offer:", error);
    }
  }, [addLocalTracks, resetPeer, setRemoteId, setSenderBitrates, socket]);

  const handleIncomingAnswer = useCallback(async ({ answer }: Answer) => {
    try {
      if (peerservice.peer.signalingState === "have-local-offer") {
        await peerservice.setRemoteDescription(answer);
        setSenderBitrates();
      }
    } catch (error) {
      console.error("Failed to handle WebRTC answer:", error);
    }
  }, [setSenderBitrates]);

  const handleNegotiationNeeded = useCallback(async () => {
    if (negotiatingRef.current) return;
    negotiatingRef.current = true;
    try {
      await createOfferAndSend("peer:nego:needed");
    } finally {
      negotiatingRef.current = false;
    }
  }, [createOfferAndSend]);

  const handleIncomingNegotiation = useCallback(async ({ offer, from }: Offer) => {
    try {
      if (peerservice.peer.signalingState !== "stable" && peerservice.peer.signalingState !== "have-local-offer") return;
      const answer = await peerservice.getAnswer(offer);
      setSenderBitrates();
      socket?.emit("peer:nego:done", { answer, to: from });
    } catch (error) {
      console.error("Failed to negotiate WebRTC connection:", error);
    }
  }, [setSenderBitrates, socket]);

  const handleFinalNegotiation = useCallback(async ({ answer }: NegotiationDone) => {
    try {
      if (peerservice.peer.signalingState === "have-local-offer") {
        await peerservice.setRemoteDescription(answer);
        setSenderBitrates();
      }
    } catch (error) {
      console.error("Failed to finish WebRTC negotiation:", error);
    }
  }, [setSenderBitrates]);

  const cleanupConnection = useCallback(() => {
    peerservice.peer.onicecandidate = null;
    peerservice.peer.ontrack = null;
    peerservice.peer.onnegotiationneeded = null;
    resetPeer();
    setRemoteStream(null);
    setRemoteId(null);
    setMessagesArray([]);
  }, [resetPeer, setRemoteId]);

  const handlePartnerDisconnected = useCallback(() => {
    cleanupConnection();
  }, [cleanupConnection]);

  const handleSkip = useCallback(() => {
    cleanupConnection();
    socket?.emit("skip");
  }, [cleanupConnection, socket]);

  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];

    if (track && isCameraOn) {
      track.enabled = false;
      setIsCameraOn(false);
      return;
    }

    if (!track) {
      const camera = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      const newTrack = camera.getVideoTracks()[0];
      stream.addTrack(newTrack);
      const sender = peerservice.peer.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);
    } else {
      track.enabled = true;
    }
    setIsCameraOn(true);
  }, [isCameraOn]);

  const toggleMic = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];

    if (track) {
      track.enabled = !isMicOn;
      setIsMicOn(!isMicOn);
      return;
    }

    const microphone = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    const newTrack = microphone.getAudioTracks()[0];
    stream.addTrack(newTrack);
    const sender = peerservice.peer.getSenders().find((s) => s.track?.kind === "audio");
    if (sender) await sender.replaceTrack(newTrack);
    setIsMicOn(true);
  }, [isMicOn]);

  const handleScreenShare = useCallback(async () => {
    const videoSender = peerservice.peer.getSenders().find((s) => s.track?.kind === "video");

    if (isScreenSharing) {
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
      if (videoSender && cameraTrack) await videoSender.replaceTrack(cameraTrack);
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
      setIsScreenSharing(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 20, max: 30 } },
        audio: false,
      });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      if (screenVideoRef.current) screenVideoRef.current.srcObject = stream;

      const screenTrack = stream.getVideoTracks()[0];
      if (videoSender) await videoSender.replaceTrack(screenTrack);
      setIsScreenSharing(true);

      screenTrack.addEventListener("ended", () => {
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack) videoSender?.replaceTrack(cameraTrack).catch(() => undefined);
        setIsScreenSharing(false);
        screenStreamRef.current = null;
        setScreenStream(null);
      }, { once: true });
    } catch (error) {
      console.error("Error sharing screen:", error);
    }
  }, [isScreenSharing]);

  useEffect(() => {
    void getUserStream().catch((error) => console.error("Unable to access camera/microphone:", error));
  }, [getUserStream]);

  useEffect(() => {
    const peer = peerservice.peer;
    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        setRemoteStream(stream);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      }
    };

    peer.onicecandidate = (event) => {
      if (event.candidate && remoteIdRef.current) {
        socket?.emit("ice-candidate", { candidate: event.candidate, to: remoteIdRef.current });
      }
    };

    peer.onnegotiationneeded = handleNegotiationNeeded;

    return () => {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onnegotiationneeded = null;
    };
  }, [handleNegotiationNeeded, socket]);

  useEffect(() => {
    if (!socket) return;

    const onIceCandidate = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try {
        await peerservice.peer.addIceCandidate(candidate);
      } catch (error) {
        console.error("Failed to add ICE candidate:", error);
      }
    };

    socket.on("user:connect", handleUserJoined);
    socket.on("offer", handleIncomingOffer);
    socket.on("answer", handleIncomingAnswer);
    socket.on("peer:nego:needed", handleIncomingNegotiation);
    socket.on("peer:nego:final", handleFinalNegotiation);
    socket.on("ice-candidate", onIceCandidate);
    socket.on("skipped", handlePartnerDisconnected);
    socket.on("partnerDisconnected", handlePartnerDisconnected);

    return () => {
      socket.off("user:connect", handleUserJoined);
      socket.off("offer", handleIncomingOffer);
      socket.off("answer", handleIncomingAnswer);
      socket.off("peer:nego:needed", handleIncomingNegotiation);
      socket.off("peer:nego:final", handleFinalNegotiation);
      socket.off("ice-candidate", onIceCandidate);
      socket.off("skipped", handlePartnerDisconnected);
      socket.off("partnerDisconnected", handlePartnerDisconnected);
    };
  }, [handleFinalNegotiation, handleIncomingAnswer, handleIncomingNegotiation, handleIncomingOffer, handlePartnerDisconnected, handleUserJoined, socket]);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = myStream;
  }, [myStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (screenVideoRef.current) screenVideoRef.current.srcObject = screenStream;
  }, [screenStream]);

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (peerservice.peer.signalingState !== "closed") peerservice.peer.close();
    };
  }, []);

  const handleCleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    setMyStream(null);
    setScreenStream(null);
    setIsScreenSharing(false);
    socket?.disconnect();
    if (peerservice.peer.signalingState !== "closed") peerservice.peer.close();
    navigate("/");
  }, [navigate, socket]);

  return (
    <div className="flex flex-col lg:flex-row w-screen bg-gradient-to-b from-gray-200 to-gray-400 dark:from-gray-800 dark:to-gray-900 transition-colors duration-300">
      <div className="lg:w-[450px] w-full lg:h-[calc(100vh-64px)] h-auto border-b lg:border-b-0 lg:border-r border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl rounded-lg overflow-hidden">
        <div className="relative w-full h-64 lg:h-1/2 bg-gray-400 dark:bg-gray-700">
          {myStream ? (
            <video ref={localVideoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover rounded-lg" />
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full">
              <ClipLoader color={loaderColor} size={50} />
              <p className="text-gray-600 dark:text-gray-300 mt-2">Loading your stream...</p>
            </div>
          )}
          <div className="absolute bottom-0 left-0 bg-gradient-to-t from-black via-transparent to-transparent p-3 text-white text-sm">My Stream</div>
        </div>

        <div className="relative w-full h-64 lg:h-1/2 bg-gray-400 dark:bg-gray-700">
          {remoteStream ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover rounded-lg" />
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full">
              <ClipLoader color={loaderColor} size={50} />
              <p className="text-gray-600 dark:text-gray-300 mt-2">Waiting for user to connect...</p>
            </div>
          )}
          <div className="absolute bottom-0 left-0 bg-gradient-to-t from-black via-transparent to-transparent p-3 text-white text-sm">Remote Stream</div>
        </div>
      </div>

      <div className="flex-1 flex flex-col w-full">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-row gap-4 h-auto sm:h-16 shadow rounded-lg bg-gray-50 dark:bg-gray-900">
          <Button className="flex-1 p-2 gap-2 bg-red-600 text-white rounded-md" size="icon" onClick={handleCleanup}><StepBack size={18} /><span className="hidden sm:inline">Stop</span></Button>
          <Button className="flex-1 p-2 gap-2 bg-blue-600 text-white rounded-md" size="icon" onClick={handleSkip} disabled={!remoteSocketId}><StepForward size={18} /><span className="hidden sm:inline">Skip</span></Button>
          <Button className="flex-1 p-2 gap-2 bg-green-600 text-white rounded-md" onClick={handleScreenShare} size="icon"><ScreenShare size={18} /><span className="hidden sm:inline">{isScreenSharing ? "Stop Sharing" : "Share Screen"}</span></Button>
          <Button className="flex-1 p-2 gap-2 bg-gray-600 text-white rounded-md" onClick={() => void toggleCamera()}>{isCameraOn ? "Turn Off Camera" : "Turn On Camera"}</Button>
          <Button className="flex-1 p-2 gap-2 bg-gray-600 text-white rounded-md" onClick={() => void toggleMic()}>{isMicOn ? "Turn Off Mic" : "Turn On Mic"}</Button>
        </div>

        <div className="flex-1 max-h-[calc(100vh-128px)] overflow-auto p-4 bg-white dark:bg-gray-800 rounded-lg shadow-inner">
          {screenStream ? (
            <video ref={screenVideoRef} autoPlay muted playsInline className="w-full h-full object-contain rounded-lg" />
          ) : (
            <Messages remoteSocketId={remoteSocketId} messagesArray={messagesArray} setMessagesArray={setMessagesArray} />
          )}
        </div>
      </div>
    </div>
  );
}
