import React, { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import jsQR from 'jsqr';
import axios from 'axios';
import * as DOMPurify from 'dompurify';
import * as THREE from 'three';

// تایپ برای پاسخ بک‌اند
interface BackendContent {
    type: 'video' | 'text' | 'image' | '3d_model' | 'html_embed';
    url?: string;
    title: string;
    description: string;
}

// تایپ برای props کامپوننت
interface ARComponentProps {
    anchorImage: string; // URL فایل .mind برای MindAR
}

// کامپوننت برای رندر ویدئو در AR
const VideoPlane: React.FC<{ url: string }> = ({ url }) => {
    const texture = new THREE.VideoTexture(document.createElement('video'));
    texture.image.src = url;
    texture.image.play();
    return (
        <mesh position={[0, 0, 0]}>
            <planeGeometry args={[1, 0.5625]} />
            <meshBasicMaterial map={texture} />
        </mesh>
    );
};

// کامپوننت برای رندر متن در AR
const TextPlane: React.FC<{ text: string }> = ({ text }) => {
    return (
        <mesh position={[0, 0, 0]}>
            <planeGeometry args={[1, 0.2]} />
            <meshBasicMaterial color="white" />
            <html>
            <div style={{ color: 'white', textAlign: 'center', width: '100%' }}>
                {text}
            </div>
            </html>
        </mesh>
    );
};

const ARComponent: React.FC<ARComponentProps> = ({ anchorImage }) => {
    const [qrResult, setQrResult] = useState<string | null>(null);
    const [content, setContent] = useState<BackendContent | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // منطق اسکن QR با jsQR
    useEffect(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        if (!qrResult && video && canvas && ctx) {
            navigator.mediaDevices
                .getUserMedia({ video: { facingMode: 'environment' } })
                .then((stream) => {
                    video.srcObject = stream;
                    video.play();

                    const scan = () => {
                        if (video.readyState === video.HAVE_ENOUGH_DATA) {
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                                inversionAttempts: 'dontInvert',
                            });

                            if (code) {
                                setQrResult(code.data);
                                setLoading(true);
                                fetchContent(code.data);
                                video.srcObject = null;
                                stream.getTracks().forEach((track) => track.stop());
                            } else {
                                requestAnimationFrame(scan);
                            }
                        } else {
                            requestAnimationFrame(scan);
                        }
                    };
                    scan();
                })
                .catch((err) => {
                    setError(`خطا در دسترسی به دوربین: ${err.message}`);
                });
        }

        return () => {
            if (video && video.srcObject) {
                const stream = video.srcObject as MediaStream;
                stream.getTracks().forEach((track) => track.stop());
            }
        };
    }, [qrResult]);

    // دریافت محتوا از بک‌اند
    const fetchContent = async (url: string) => {
        try {
            const response = await axios.get<BackendContent>(url);
            const sanitizedContent: BackendContent = {
                ...response.data,
                description: DOMPurify.sanitize(response.data.description),
            };
            setContent(sanitizedContent);
            setLoading(false);
        } catch (err) {
            setError(`خطا در دریافت محتوا: ${(err as Error).message}`);
            setLoading(false);
        }
    };

    // ریست برای اسکن مجدد
    const handleRescan = () => {
        setQrResult(null);
        setContent(null);
        setError(null);
    };

    return (
        <div className="relative w-full h-full">
            {error && (
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded">
                    {error}
                    <button
                        className="ml-4 bg-blue-500 text-white px-2 py-1 rounded"
                        onClick={handleRescan}
                    >
                        اسکن مجدد
                    </button>
                </div>
            )}
            {loading && (
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-80 text-white px-4 py-2 rounded">
                    در حال بارگذاری محتوا...
                </div>
            )}
            {!qrResult && (
                <div className="absolute top-0 left-0 w-full h-full">
                    <video ref={videoRef} style={{ display: 'none' }} />
                    <canvas ref={canvasRef} width="640" height="480" className="w-full h-full" />
                </div>
            )}
            {content && (
                <Canvas
                    camera={{ position: [0, 0, 1], fov: 60 }}
                    style={{ width: '100vw', height: '100vh' }}
                >
                    <ambientLight intensity={0.5} />
                    <pointLight position={[10, 10, 10]} />
                    {/* فرض می‌کنیم MindAR تصویر را شناسایی کرده و مختصات را به react-three-fiber می‌دهد */}
                    {content.type === 'video' && content.url && <VideoPlane url={content.url} />}
                    {content.type === 'text' && <TextPlane text={content.description} />}
                </Canvas>
            )}
        </div>
    );
};

export default ARComponent;