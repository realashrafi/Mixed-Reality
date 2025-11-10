import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import jsQR from "jsqr";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { motion, AnimatePresence } from "framer-motion";
// فقط prod.js
import { MindARThree } from "mind-ar/dist/mindar-image-three.prod.js";

/* ---------------- Types ---------------- */
interface BackendContent {
    modelUrl: string;
    videoUrl: string;
    title: string;
    description: string;
}

interface ARComponentProps {
    anchorImage: string; // URL .mind
    testMode?: boolean; // اگر true باشد، دکمه «اسکن آزمایشی» نمایش داده می‌شود
}

/* ---------------- Phase 1: QR Scanner ---------------- */
const QRScanner: React.FC<{
    onScanned: (qr?: string) => void;
    onError?: (e: any) => void;
    testMode?: boolean;
}> = ({ onScanned, onError, testMode }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        let scanning = true;
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: "environment" },
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                    },
                    audio: false,
                });
                streamRef.current = stream;
                const video = videoRef.current!;
                video.srcObject = stream;
                video.setAttribute("playsinline", "true");
                await video.play();

                const scanLoop = () => {
                    if (!scanning) return;
                    const v = videoRef.current,
                        c = canvasRef.current;
                    if (!v || !c || v.readyState < v.HAVE_ENOUGH_DATA || v.videoWidth === 0) {
                        requestAnimationFrame(scanLoop);
                        return;
                    }
                    // حفظ نسبت تصویر و جلوگیری از کشیدگی با drawImage روی ابعاد واقعی
                    c.width = v.videoWidth;
                    c.height = v.videoHeight;
                    const ctx = c.getContext("2d")!;
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(v, 0, 0, c.width, c.height);
                    const frame = ctx.getImageData(0, 0, c.width, c.height);
                    const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
                    if (code) {
                        scanning = false;
                        streamRef.current?.getTracks().forEach((t) => t.stop());
                        onScanned(code.data);
                    } else {
                        requestAnimationFrame(scanLoop);
                    }
                };
                requestAnimationFrame(scanLoop);
            } catch (e) {
                onError?.(e);
                // در تست مود، اگر اجازه دوربین نداد هم می‌تونیم با دکمه دستی اسکن کنیم
            }
        })();

        return () => {
            scanning = false;
            streamRef.current?.getTracks().forEach((t) => t.stop());
        };
    }, [onScanned, onError]);

    return (
        <div className="absolute inset-0 bg-black">
            <video ref={videoRef} className="hidden" />
            <canvas ref={canvasRef} className="w-full h-full object-cover" />

            <div className="absolute inset-x-0 bottom-4 flex justify-center">
                <div className="px-4 py-2 rounded-full bg-black/60 text-white text-sm font-semibold shadow">
                    QR را روبه‌روی دوربین نگه دارید
                </div>
            </div>

            {testMode && (
                <div className="absolute inset-x-0 top-4 flex justify-center">
                    <button
                        onClick={() => onScanned("TEST_QR")}
                        className="px-4 py-2 rounded-full bg-white text-black text-sm font-semibold shadow active:scale-95 transition"
                    >
                        اسکن آزمایشی
                    </button>
                </div>
            )}
        </div>
    );
};

/* ---------------- Phase 3: MR Scene ---------------- */
const MRScene: React.FC<{ content: BackendContent; anchorImage: string }> = ({ content, anchorImage }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let mindar: any;
        let stopLoop: (() => void) | null = null;

        // Raycaster برای دکمه
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();

        // Smoothing
        const smPos = new THREE.Vector3();
        const smQuat = new THREE.Quaternion();
        let smInit = false;

        // برای gating کلیک تا بعد از پیدا شدن تارگت
        let targetFound = false;

        // برای ریسپانسیو (با reference ثابت برای cleanup درست)
        let resizeHandler: () => void;

        (async () => {
            (window as any).MIND_TARGET = anchorImage;
            mindar = new MindARThree({
                container: containerRef.current!,
                imageTargetSrc: (window as any).MIND_TARGET,
                filterMinCF: 0.001,
                filterBeta: 0.06,
                maxTrack: 1,
                uiLoading: "no",
                uiScanning: "no",
                uiError: "yes",
            });

            const { renderer, scene, camera } = mindar;
            renderer.setClearColor(0x000000, 0);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

            const resize = () => {
                const w = containerRef.current?.clientWidth ?? window.innerWidth;
                const h = containerRef.current?.clientHeight ?? window.innerHeight;
                renderer.setSize(w, h, false);
                // @ts-ignore
                if ((camera as any).aspect !== undefined) {
                    // @ts-ignore
                    (camera as any).aspect = w / h;
                    // @ts-ignore
                    (camera as any).updateProjectionMatrix?.();
                }
            };
            resize();
            resizeHandler = resize;
            window.addEventListener("resize", resizeHandler);

            scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.2));

            const anchor = mindar.addAnchor(0);

            // رویدادهای پیدا/گم شدن تارگت
            anchor.onTargetFound = () => {
                targetFound = true;
                tryPlay();
            };
            anchor.onTargetLost = () => {
                targetFound = false;
            };

            // مدل سه‌بعدی
            new GLTFLoader().load(
                content.modelUrl,
                (gltf) => {
                    const model = gltf.scene;
                    model.scale.set(0.18, 0.18, 0.18);
                    model.position.set(0, 0.15, 0);
                    model.rotation.set(0, Math.PI, 0);
                    anchor.group.add(model);
                },
                undefined,
                (err) => console.warn("GLTF load error:", err)
            );

            // ویدیو زیر مدل (با اصلاح نسبت تصویر)
            const videoEl = document.createElement("video");
            videoEl.muted = true; // باید قبل از src ست شود
            videoEl.autoplay = true;
            videoEl.playsInline = true;
            videoEl.setAttribute("muted", "");
            videoEl.setAttribute("playsinline", "");
            videoEl.src = content.videoUrl;
            videoEl.loop = true;

            const tryPlay = () => videoEl.play().catch(() => {});
            tryPlay();

            // Gesture unlock روی canvas
            renderer.domElement.style.touchAction = "none";
            const unlock = () => {
                tryPlay();
            };
            renderer.domElement.addEventListener("pointerdown", unlock);

            const vTex = new THREE.VideoTexture(videoEl);
            // @ts-ignore
            (vTex as any).colorSpace = (THREE as any).SRGBColorSpace ?? (vTex as any).colorSpace;
            vTex.needsUpdate = true;

            // ابتدا با نسبت 16:9 می‌سازیم، بعد از loadedmetadata اصلاح می‌کنیم
            const videoPlane = new THREE.Mesh(
                new THREE.PlaneGeometry(1.1, 1.1 * (9 / 16)),
                new THREE.MeshBasicMaterial({ map: vTex, transparent: true })
            );
            videoPlane.position.set(0, -0.45, 0);
            anchor.group.add(videoPlane);

            // وقتی ویدئو متادیتا داد، نسبت را دقیق تنظیم کن
            const onMeta = () => {
                const vw = videoEl.videoWidth || 16;
                const vh = videoEl.videoHeight || 9;
                const aspect = vw / vh;
                const width = 1.1;
                const height = width / aspect;
                (videoPlane.geometry as THREE.PlaneGeometry).dispose();
                videoPlane.geometry = new THREE.PlaneGeometry(width, height);
            };
            videoEl.addEventListener("loadedmetadata", onMeta);

            // عنوان
            const titleCanvas = document.createElement("canvas");
            titleCanvas.width = 1024;
            titleCanvas.height = 220;
            const tctx = titleCanvas.getContext("2d")!;
            tctx.fillStyle = "rgba(0,0,0,0.55)";
            tctx.fillRect(0, 0, titleCanvas.width, titleCanvas.height);
            tctx.fillStyle = "#fff";
            tctx.font = "bold 100px Arial";
            tctx.textAlign = "center";
            tctx.textBaseline = "middle";
            tctx.fillText(content.title, titleCanvas.width / 2, titleCanvas.height / 2);
            const titleTex = new THREE.CanvasTexture(titleCanvas);
            const titleMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(1.25, 0.26),
                new THREE.MeshBasicMaterial({ map: titleTex, transparent: true })
            );
            titleMesh.position.set(0, -0.78, 0);
            anchor.group.add(titleMesh);

            // دیسکریپشن (ساده و تک‌خط؛ در صورت نیاز به wrap‌ می‌توان توسعه داد)
            const descCanvas = document.createElement("canvas");
            descCanvas.width = 1024;
            descCanvas.height = 300;
            const dctx = descCanvas.getContext("2d")!;
            dctx.fillStyle = "rgba(0,0,0,0.42)";
            dctx.fillRect(0, 0, descCanvas.width, descCanvas.height);
            dctx.fillStyle = "#eaeaea";
            dctx.font = "48px Arial";
            dctx.textAlign = "center";
            dctx.textBaseline = "middle";
            dctx.fillText(content.description, descCanvas.width / 2, descCanvas.height / 2);
            const descTex = new THREE.CanvasTexture(descCanvas);
            const descMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(1.35, 0.34),
                new THREE.MeshBasicMaterial({ map: descTex, transparent: true })
            );
            descMesh.position.set(0, -1.08, 0);
            anchor.group.add(descMesh);

            // دکمه قابل کلیک (Raycaster)
            const btnGeom = new THREE.PlaneGeometry(0.64, 0.26);
            const btnMat = new THREE.MeshBasicMaterial({ color: 0x2b7cff, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
            const btnMesh = new THREE.Mesh(btnGeom, btnMat);
            btnMesh.position.set(0, -1.38, 0);
            btnMesh.name = "cta";
            anchor.group.add(btnMesh);

            const handlePointer = (clientX: number, clientY: number) => {
                if (!targetFound) return; // قبل از پیدا شدن تارگت کلیک نکن
                const rect = renderer.domElement.getBoundingClientRect();
                pointer.set(
                    ((clientX - rect.left) / rect.width) * 2 - 1,
                    -(((clientY - rect.top) / rect.height) * 2 - 1)
                );
                raycaster.setFromCamera(pointer, camera);
                const hits = raycaster.intersectObjects([btnMesh], true);
                if (hits.length) {
                    alert("✅ دکمه کلیک شد");
                }
            };
            const onPointerDown = (e: PointerEvent) => handlePointer(e.clientX, e.clientY);
            renderer.domElement.addEventListener("pointerdown", onPointerDown);

            // شروع AR
            await mindar.start();

            // رندرلوپ + smoothing pose + آپدیت تکسچر ویدیو
            const tmpPos = new THREE.Vector3();
            const tmpQuat = new THREE.Quaternion();
            (renderer as THREE.WebGLRenderer).setAnimationLoop(() => {
                // اطمینان از آپدیت بافت ویدیو
                (vTex as any).needsUpdate = true;

                anchor.group.getWorldPosition(tmpPos);
                anchor.group.getWorldQuaternion(tmpQuat);
                if (!smInit) {
                    smPos.copy(tmpPos);
                    smQuat.copy(tmpQuat);
                    smInit = true;
                } else {
                    smPos.lerp(tmpPos, 0.15);
                    smQuat.slerp(tmpQuat, 0.15);
                }
                anchor.group.position.copy(smPos);
                anchor.group.quaternion.copy(smQuat);
                (renderer as THREE.WebGLRenderer).render(scene, camera);
            });
            stopLoop = () => (renderer as THREE.WebGLRenderer).setAnimationLoop(null);

            // پاکسازی event ها در return از async IIFE
            return () => {
                renderer.domElement.removeEventListener("pointerdown", onPointerDown);
                renderer.domElement.removeEventListener("pointerdown", unlock);
                videoEl.removeEventListener("loadedmetadata", onMeta);
            };
        })();

        // Cleanup اصلی useEffect
        return () => {
            try {
                stopLoop?.();
            } catch {}
            try {
                (mindar as any)?.controller?.stop?.();
                (mindar as any)?.video?.srcObject?.getTracks?.().forEach((t: MediaStreamTrack) => t.stop());
            } catch {}
            if (resizeHandler) window.removeEventListener("resize", resizeHandler);
        };
    }, [content, anchorImage]);

    return <div ref={containerRef} className="absolute inset-0 bg-transparent touch-none w-full h-[100dvh]" />;
};

/* ---------------- Phase Orchestrator: (QR → Loading → MR) ---------------- */
const ARIntegratedFlow: React.FC<ARComponentProps> = ({ anchorImage, testMode = true }) => {
    const [phase, setPhase] = useState<"qr" | "loading" | "ar">("qr");
    const [content, setContent] = useState<BackendContent | null>(null);

    const fetchFake = async (qr?: string) => {
        // شبیه‌سازی fetch محتوا بر اساس QR (فعلاً ثابت)
        await new Promise((r) => setTimeout(r, 1000));
        return {
            modelUrl:
                "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
            title: "اردک سه‌بعدی",
            description: qr ? `محتوا پس از اسکن QR: ${qr}` : "سکانس MR تستی (بدون QR)",
        } as BackendContent;
    };

    const handleQRScanned = async (qrData?: string) => {
        setPhase("loading");
        const data = await fetchFake(qrData);
        setContent(data);
        setPhase("ar");
    };

    return (
        <div className="relative w-screen h-[100dvh] overflow-hidden bg-black">
            <AnimatePresence initial={false} mode="wait">
                {phase === "qr" && (
                    <motion.div key="qr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
                        <QRScanner onScanned={handleQRScanned} testMode={testMode} />
                    </motion.div>
                )}

                {phase === "loading" && (
                    <motion.div
                        key="loading"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center bg-black/70"
                    >
                        <div className="flex flex-col items-center space-y-3 text-white">
                            <div className="h-10 w-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
                            <div className="text-sm font-medium">در حال بارگذاری سکانس MR...</div>
                        </div>
                    </motion.div>
                )}

                {phase === "ar" && content && (
                    <motion.div key="ar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
                        <MRScene content={content} anchorImage={anchorImage} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ARIntegratedFlow;
