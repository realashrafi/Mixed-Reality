//@ts-nocheck
import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Loader } from '@react-three/drei';
import * as THREE from 'three';
import jsQR from 'jsqr';
import * as DOMPurify from 'dompurify';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';

interface BackendContent {
    type: 'video' | 'text' | 'image' | '3d_model' | 'html_embed';
    url?: string;
    title: string;
    description: string;
}

interface ARComponentProps {
    anchorImage: string; // URL فایل .mind
}

const QRScanner: React.FC<{ onScan: (data: string) => void; onError: (msg: string) => void }> = ({ onScan, onError }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const video = videoRef.current!;
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;

        navigator.mediaDevices
            .getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },  // کیفیت HD (720p) - برای 1080p: 1920
                    height: { ideal: 720 },  // برای 1080p: 1080
                },
            })
            .then((stream) => {
                video.srcObject = stream;
                video.play();

                const scan = () => {
                    if (video.readyState === video.HAVE_ENOUGH_DATA) {
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const code = jsQR(imageData.data, imageData.width, imageData.height);
                        if (code) {
                            onScan(code.data);
                            stream.getTracks().forEach((t) => t.stop());
                        } else {
                            requestAnimationFrame(scan);
                        }
                    } else {
                        requestAnimationFrame(scan);
                    }
                };
                scan();
            })
            .catch((err) => onError(`دوربین: ${err.message}`));

        return () => {
            if (video.srcObject) {
                (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
            }
        };
    }, [onScan, onError]);

    return (
        <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
            <video ref={videoRef} style={{ display: 'none' }} />
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
            <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', color: '#fff' }}>
                QR کد را در کادر قرار دهید
            </div>
        </div>
    );
};

const MRScene: React.FC<{ content: BackendContent }> = ({ content }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mindarRef = useRef<MindARThree | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        let mindarThree: MindARThree | null = null;

        const startAR = async () => {
            try {
                mindarThree = new MindARThree({
                    container: containerRef.current!,
                    imageTargetSrc: (window as any).MIND_TARGET,
                    maxTrack: 1,
                    uiLoading: 'no',
                    uiScanning: 'no',
                    uiError: 'no',
                    videoParams: {  // افزایش کیفیت دوربین در MindAR
                        facingMode: 'environment',
                        width: 1280,  // HD (720p) - برای 1080p: 1920
                        height: 720,  // برای 1080p: 1080
                    },
                });
                mindarRef.current = mindarThree;

                const { renderer, scene, camera } = mindarThree;
                const anchor = mindarThree.addAnchor(0);

                if (content.type === 'video' && content.url) {
                    const video = document.createElement('video');
                    videoRef.current = video;
                    video.src = content.url;
                    video.crossOrigin = 'anonymous';
                    video.loop = true;
                    video.muted = true;

                    video.addEventListener('loadedmetadata', () => {
                        video.play().catch((error) => {
                            console.warn('ویدیو play interrupted:', error);
                        });
                    });

                    const texture = new THREE.VideoTexture(video);
                    texture.needsUpdate = true;

                    const geometry = new THREE.PlaneGeometry(1, 0.5625);
                    const material = new THREE.MeshBasicMaterial({ map: texture });
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.set(0, 0, 0);
                    mesh.scale.set(1, 1, 1);
                    anchor.group.add(mesh);
                }

                if (content.type === 'text') {
                    const cleanText = DOMPurify.sanitize(content.description);
                    const canvas = document.createElement('canvas');
                    canvas.width = 512;
                    canvas.height = 128;
                    const ctx = canvas.getContext('2d')!;
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#fff';
                    ctx.font = '40px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText(cleanText, canvas.width / 2, 80);

                    const texture = new THREE.CanvasTexture(canvas);
                    const geometry = new THREE.PlaneGeometry(1, 0.25);
                    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
                    const mesh = new THREE.Mesh(geometry, material);
                    anchor.group.add(mesh);
                }

                await mindarThree.start();

                const animate = () => {
                    renderer.render(scene, camera);
                    requestAnimationFrame(animate);
                };
                animate();
            } catch (err: any) {
                console.error('خطا در MindAR:', err);
            }
        };

        startAR();

        return () => {
            if (mindarRef.current) {
                try {
                    mindarRef.current.stop();
                } catch (err) {
                    console.warn('خطا در stop MindAR:', err);
                }
            }
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.src = '';
            }
            mindarRef.current = null;
        };
    }, [content]);

    return (
        <>
            <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />
            <Loader />
        </>
    );
};

const ARComponent: React.FC<ARComponentProps> = ({ anchorImage }) => {
    const [qrData, setQrData] = useState<string | null>(null);
    const [content, setContent] = useState<BackendContent | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        (window as any).MIND_TARGET = anchorImage;
    }, [anchorImage]);

    const fetchContent = async (qr: string) => {
        setLoading(true);
        try {
            await new Promise((r) => setTimeout(r, 1000));
            setContent({
                type: 'video', // یا 'text' برای تست
                url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
                title: 'ویدیو MR',
                description: 'این یک تجربه MR پایدار است!',
            });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleScan = (data: string) => {
        setQrData(data);
        fetchContent(data);
    };

    const reset = () => {
        setQrData(null);
        setContent(null);
        setError(null);
    };

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
            {error && (
                <div
                    style={{
                        position: 'absolute',
                        top: 16,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: '#d32f2f',
                        color: 'white',
                        padding: '12px 24px',
                        borderRadius: 8,
                        zIndex: 1000,
                    }}
                >
                    {error}
                    <button
                        onClick={reset}
                        style={{
                            marginLeft: 12,
                            background: '#1976d2',
                            color: 'white',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: 4,
                            cursor: 'pointer',
                        }}
                    >
                        دوباره
                    </button>
                </div>
            )}

            {loading && (
                <div
                    style={{
                        position: 'absolute',
                        top: 16,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.8)',
                        color: 'white',
                        padding: '12px 24px',
                        borderRadius: 8,
                        zIndex: 1000,
                    }}
                >
                    در حال بارگذاری محتوا...
                </div>
            )}

            {!qrData && !content && <QRScanner onScan={handleScan} onError={setError} />}

            {content && (
                <Suspense fallback={null}>
                    <MRScene content={content} />
                </Suspense>
            )}
        </div>
    );
};

export default ARComponent;