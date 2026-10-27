"use client";

import dynamic from "next/dynamic";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./globe2.css";

const CesiumLab = dynamic(() => import("@/components/lab/globe2/CesiumLab"), { ssr: false });

export default function Globe2LabPage() { return <CesiumLab />; }
