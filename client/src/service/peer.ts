class PeerService {
    public peer!: RTCPeerConnection;

    constructor() {
        this.initPeer();
    }

    initPeer() {
        if (this.peer && this.peer.signalingState !== "closed") {
            this.peer.close();
        }

        const iceServers: RTCIceServer[] = [
            { urls: "stun:stun.l.google.com:19302" },
        ];

        // Optional TURN server for users behind restrictive NAT/firewalls.
        // Configure VITE_TURN_SERVER, VITE_TURN_USERNAME and VITE_TURN_CREDENTIALS
        // in the frontend environment when a TURN provider is available.
        const turnServer = import.meta.env.VITE_TURN_SERVER;
        const turnUsername = import.meta.env.VITE_TURN_USERNAME;
        const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

        if (turnServer && turnUsername && turnCredential) {
            iceServers.push({
                urls: turnServer,
                username: turnUsername,
                credential: turnCredential,
            });
        }

        this.peer = new RTCPeerConnection({
            iceServers,
            bundlePolicy: "max-bundle",
            rtcpMuxPolicy: "require",
        });
    }

    async getOffer() {
        const offer = await this.peer.createOffer();
        await this.peer.setLocalDescription(offer);
        return this.peer.localDescription;
    }

    async getAnswer(offer: RTCSessionDescriptionInit) {
        await this.peer.setRemoteDescription(offer);
        const answer = await this.peer.createAnswer();
        await this.peer.setLocalDescription(answer);
        return this.peer.localDescription;
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit) {
        await this.peer.setRemoteDescription(description);
    }
}

const peerservice = new PeerService();
export default peerservice;
