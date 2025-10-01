import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import jsQR from 'jsqr';
import DOMPurify from 'dompurify';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer';

interface Content {
    type: 'plane' | 'video' | 'custom';
    content: string | React.ReactNode;
    videoElement?: HTMLVideoElement; // برای videoTexture
}

const ContentManager = {
    async fetchContent(qrData: string): Promise<Content> {
        try {
            const response = await fetch(qrData);
            if (!response.ok) throw new Error('خطا در دریافت داده از API');
            const data = await response.json();

            const sanitizedStatus = DOMPurify.sanitize(data.status || data.title || 'بدون عنوان');
            const sanitizedDetails = DOMPurify.sanitize(data.deliveryDate || data.body || 'بدون جزئیات');

            // شبیه‌سازی API لجستیک
            const mockLogisticsData = {
                videoUrl: data.videoUrl || 'https://www.pexels.com/download/video/3195394/',
                trackingUrl: data.trackingUrl || null,
            };

            if (mockLogisticsData.videoUrl) {
                const video = document.createElement('video');
                video.src = mockLogisticsData.videoUrl;
                video.muted = true;
                video.loop = true;
                video.play().catch((err) => console.error('خطا در پخش ویدیو:', err));
                return {
                    type: 'video',
                    content: mockLogisticsData.videoUrl,
                    videoElement: video,
                };
            } else if (mockLogisticsData.trackingUrl) {
                return {
                    type: 'custom',
                    content: (
                        <iframe
                            src={mockLogisticsData.trackingUrl}
                            width="100%"
                            height="100%"
                            title="Tracking Page"
                            className="border-none"
                        />
                    ),
                };
            }
            return {
                type: 'plane',
                content: `
          <div style="background: rgba(255, 255, 255, 0.9); padding: 10px; text-align: center;">
            <h3>${sanitizedStatus}</h3>
            <p>${sanitizedDetails}</p>
          </div>
        `,
            };
        } catch (err) {
            throw new Error('خطا در دریافت محتوا: ' + (err as Error).message);
        }
    },
};

const ARContent: React.FC<{ content: Content | null }> = ({ content }) => {
    const groupRef = useRef<THREE.Group>(null);
    const [mindAR, setMindAR] = useState<any>(null);

    useEffect(() => {
        const initMindAR = async () => {
            try {
                const { MindARThree } = await import('mind-ar/dist/mindar-image-three.prod.js');
                const mindarThree = new MindARThree({
                    container: document.querySelector('.ar-container')!,
                    imageTargetSrc: '/targets.mind',
                });
                const { renderer, scene, camera } = mindarThree;
                await mindarThree.start();
                renderer.setAnimationLoop(() => {
                    renderer.render(scene, camera);
                });
                setMindAR(mindarThree);
            } catch (err) {
                console.error('خطا در مقداردهی MindAR:', err);
            }
        };
        initMindAR();
        return () => {
            if (mindAR) {
                mindAR.stop();
                mindAR.renderer.setAnimationLoop(null);
            }
        };
    }, []);

    useFrame(() => {
        if (mindAR && groupRef.current) {
            const anchor = mindAR.anchors[0];
            groupRef.current.visible = anchor?.visible || false;
        }
    });

    if (!content || !mindAR) return null;

    return (
        <>
            {content.type === 'plane' && (
                <mesh position={[0, 0, -0.5]}>
                    <planeGeometry args={[2, 1]} />
                    <meshBasicMaterial color="#f0f0f0" transparent opacity={0.9}>
                        <primitive object={new CSS3DObject(document.createElement('div'))}>
                            <div dangerouslySetInnerHTML={{ __html: content.content as string }} />
                        </primitive>
                    </meshBasicMaterial>
                </mesh>
            )}
            {content.type === 'video' && content.videoElement && (
                <mesh position={[0, 0, -0.5]}>
                    <planeGeometry args={[2, 1.5]} />
                    <meshBasicMaterial>
                        <videoTexture attach="map" args={[content.videoElement]} />
                    </meshBasicMaterial>
                </mesh>
            )}
            {content.type === 'custom' && (
                <mesh position={[0, 0, -0.5]}>
                    <planeGeometry args={[2, 1.5]} />
                    <meshBasicMaterial color="#ffffff">
                        <primitive object={new CSS3DObject(document.createElement('div'))}>
                            {content.content}
                        </primitive>
                    </meshBasicMaterial>
                </mesh>
            )}
        </>
    );
};

const ARIntegrated: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [content, setContent] = useState<Content | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState<boolean>(true);
    const [manualInput, setManualInput] = useState<string>('');
    const [isBrowserSupported, setIsBrowserSupported] = useState<boolean>(true);

    const checkBrowserSupport = useCallback(() => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setIsBrowserSupported(false);
            setError('این مرورگر از دسترسی به دوربین پشتیبانی نمی‌کند');
            return false;
        }
        return true;
    }, []);

    const startCamera = useCallback(async () => {
        if (!checkBrowserSupport()) return;

        try {
            if (!streamRef.current) {
                streamRef.current = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = streamRef.current;
                    videoRef.current.onloadedmetadata = () => {
                        videoRef.current?.play().catch((err) => {
                            setError('خطا در پخش ویدیو: ' + err.message);
                        });
                        requestAnimationFrame(scanQRCode);
                    };
                }
            }
        } catch (err) {
            setError('خطا در دسترسی به دوربین: ' + (err as Error).message);
        }
    }, [checkBrowserSupport]);

    const scanQRCode = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
            if (isScanning) requestAnimationFrame(scanQRCode);
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            if (isScanning) requestAnimationFrame(scanQRCode);
            return;
        }
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
            setIsScanning(false);
            fetchAndRenderContent(code.data);
        }
        if (isScanning) requestAnimationFrame(scanQRCode);
    }, [isScanning]);

    const fetchAndRenderContent = useCallback(async (qrData: string) => {
        setLoading(true);
        try {
            const newContent = await ContentManager.fetchContent(qrData);
            setContent(newContent);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
            setTimeout(() => setIsScanning(true), 3000);
        }
    }, []);

    const handleManualSubmit = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            if (manualInput) {
                setIsScanning(false);
                fetchAndRenderContent(manualInput);
            }
        },
        [manualInput, fetchAndRenderContent]
    );

    useEffect(() => {
        startCamera();
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
            }
        };
    }, [startCamera]);

    if (!isBrowserSupported) {
        return (
            <motion.div
                className="w-full max-w-md mx-auto text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
            >
                <p className="text-red-500" role="alert">
                    {error}
                </p>
            </motion.div>
        );
    }

    return (
        <motion.div
            className="w-full max-w-md mx-auto text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
        >
            <h2 className="text-2xl font-bold text-white mb-4">اسکن و نمایش AR</h2>
            <div className="relative rounded-lg overflow-hidden shadow-lg h-96 ar-container">
                {content ? (
                    <Canvas>
                        <ARContent content={content} />
                    </Canvas>
                ) : (
                    <>
                        <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                        <canvas ref={canvasRef} className="hidden" />
                    </>
                )}
                {loading && (
                    <motion.div
                        className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                        role="status"
                        aria-live="polite"
                    >
                        <p className="text-white">در حال لود کردن محتوا...</p>
                    </motion.div>
                )}
                {error && (
                    <motion.div
                        className="absolute inset-0 flex items-center justify-center bg-red-500 bg-opacity-50"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                        role="alert"
                        aria-live="assertive"
                    >
                        <p className="text-white">{error}</p>
                    </motion.div>
                )}
                <motion.div
                    className="absolute inset-0 border-4 border-transparent"
                    animate={{
                        borderColor: ['rgba(59, 130, 246, 0.5)', 'rgba(59, 130, 246, 0.2)'],
                    }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                >
                    <div
                        className="absolute inset-0 flex items-center justify-center border-2 border-dashed border-blue-400"
                        style={{ margin: '10%' }}
                        aria-hidden="true"
                    />
                </motion.div>
            </div>
            <div className="mt-4">
                <input
                    type="text"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="URL را به صورت دستی وارد کنید"
                    className="p-2 rounded-md text-black"
                    aria-label="وارد کردن URL کد QR به صورت دستی"
                />
                <button
                    onClick={handleManualSubmit}
                    className="ml-2 p-2 bg-blue-500 text-white rounded-md"
                    aria-label="ارسال URL دستی"
                >
                    ارسال
                </button>
            </div>
            <button
                onClick={() => setIsScanning(true)}
                className="mt-2 p-2 bg-green-500 text-white rounded-md"
                aria-label="شروع مجدد اسکن QR"
            >
                اسکن مجدد
            </button>
            <p className="text-gray-300 mt-2" role="status" aria-live="polite">
                {isScanning ? 'دوربین را روی کد QR بگیرید' : 'QR شناسایی شد!'}
            </p>
        </motion.div>
    );
};

export default ARIntegrated;