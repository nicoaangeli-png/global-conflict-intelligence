'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CAMERA, GLOBE } from '@/lib/config/visual';
import { clusterDegreesForCamera } from '@/lib/clustering/cluster';
import { vector3ToLatLon } from '@/lib/geo/latlon';
import { countryAt } from '@/lib/geo/world';
import { loadWorld } from '@/lib/geo/referentials';
import { HolographicEarth } from './HolographicEarth';
import { OrbitLayer } from './OrbitLayer';
import { Starfield } from './Starfield';
import { ConflictLayer } from '../conflicts/ConflictLayer';
import { useIntelStore } from '@/store/useIntelStore';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function GlobeScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const holographicEarthRef = useRef<HolographicEarth | null>(null);
  const orbitLayerRef = useRef<OrbitLayer | null>(null);
  const starfieldRef = useRef<Starfield | null>(null);
  const conflictLayerRef = useRef<ConflictLayer | null>(null);

  const clusters = useIntelStore((s) => s.clusters);
  const selected = useIntelStore((s) => s.selected);
  const hoveredId = useIntelStore((s) => s.hoveredId);
  const focusRequest = useIntelStore((s) => s.focusRequest);
  const select = useIntelStore((s) => s.select);
  const hover = useIntelStore((s) => s.hover);
  const setDegrees = useIntelStore((s) => s.setDegrees);
  const setCountry = useIntelStore((s) => s.setCountry);
  const setHoveredCountry = useIntelStore((s) => s.setHoveredCountry);

  const sphericalRef = useRef<{ distance: number; targetDistance: number; theta: number; targetTheta: number; phi: number; targetPhi: number; }>({
    distance: CAMERA.initial.distance,
    targetDistance: CAMERA.initial.distance,
    theta: CAMERA.initial.theta,
    targetTheta: CAMERA.initial.theta,
    phi: CAMERA.initial.phi,
    targetPhi: CAMERA.initial.phi,
  });

  const isDraggingRef = useRef(false);
  const previousMousePosRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ theta: 0, phi: 0 });
  const lastInteractionTimeRef = useRef(Date.now());
  const lastReportedDegrees = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let width = container.clientWidth;
    let height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x010409, 0.002);

    const fov = CAMERA.fov;
    const camera = new THREE.PerspectiveCamera(fov, width / height, CAMERA.near, CAMERA.far);
    camera.position.set(0, 0, CAMERA.initial.distance);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // Initialisation des couches
    const starfield = new Starfield();
    scene.add(starfield.group);
    starfieldRef.current = starfield;

    const holographicEarth = new HolographicEarth(GLOBE.radius);
    globeGroup.add(holographicEarth.group);
    holographicEarthRef.current = holographicEarth;

    const orbitLayer = new OrbitLayer();
    globeGroup.add(orbitLayer.group);
    orbitLayerRef.current = orbitLayer;

    const conflictLayer = new ConflictLayer(GLOBE.radius);
    globeGroup.add(conflictLayer.group);
    conflictLayerRef.current = conflictLayer;

    // Raycasting & picking analytique exact sur la sphère terrestre
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), GLOBE.radius);
    const hitPoint = new THREE.Vector3();
    const worldIndexPromise = loadWorld();

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      previousMousePosRef.current = { x: e.clientX, y: e.clientY };
      lastInteractionTimeRef.current = Date.now();
      velocityRef.current = { theta: 0, phi: 0 };
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (isDraggingRef.current) {
        const deltaX = e.clientX - previousMousePosRef.current.x;
        const deltaY = e.clientY - previousMousePosRef.current.y;

        const vTheta = -deltaX * CAMERA.rotateSpeed;
        const vPhi = -deltaY * CAMERA.rotateSpeed;

        velocityRef.current = { theta: vTheta, phi: vPhi };
        sphericalRef.current.targetTheta += vTheta;
        sphericalRef.current.targetPhi = clamp(
          sphericalRef.current.targetPhi + vPhi,
          0.12,
          Math.PI - 0.12
        );

        previousMousePosRef.current = { x: e.clientX, y: e.clientY };
        lastInteractionTimeRef.current = Date.now();
        hover(null);
        setHoveredCountry(null);
      } else {
        raycaster.setFromCamera(mouse, camera);
        const hit = conflictLayerRef.current?.hitTest(raycaster, camera) || null;
        if (hit) {
          container.style.cursor = 'pointer';
          hover(hit.id);
          setHoveredCountry(null);
        } else {
          hover(null);

          // Inspection pays au survol via intersection analytique sur la sphère
          if (raycaster.ray.intersectSphere(earthSphere, hitPoint)) {
            const geo = vector3ToLatLon(hitPoint);
            worldIndexPromise.then((w) => {
              const c = countryAt(w, geo.lat, geo.lon);
              if (c) {
                container.style.cursor = 'pointer';
                setHoveredCountry({ name: c.name, iso: c.iso, lat: geo.lat, lon: geo.lon });
              } else {
                container.style.cursor = 'default';
                setHoveredCountry(null);
              }
            });
          } else {
            container.style.cursor = 'default';
            setHoveredCountry(null);
          }
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const dx = Math.abs(e.clientX - previousMousePosRef.current.x);
        const dy = Math.abs(e.clientY - previousMousePosRef.current.y);
        // Clic sans glisser
        if (dx < 4 && dy < 4) {
          raycaster.setFromCamera(mouse, camera);
          const hit = conflictLayerRef.current?.hitTest(raycaster, camera) || null;
          if (hit) {
            void select(hit);
          } else {
            // Clic sur un pays pour ouvrir la fiche détaillée Pentagone
            if (raycaster.ray.intersectSphere(earthSphere, hitPoint)) {
              const geo = vector3ToLatLon(hitPoint);
              worldIndexPromise.then((w) => {
                const c = countryAt(w, geo.lat, geo.lon);
                if (c) {
                  setCountry({ name: c.name, iso: c.iso, lat: geo.lat, lon: geo.lon });
                } else {
                  setCountry(null);
                }
              });
            } else {
              setCountry(null);
            }
          }
        }
      }
      isDraggingRef.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInteractionTimeRef.current = Date.now();
      const zoomDelta = e.deltaY * 0.003;
      sphericalRef.current.targetDistance = clamp(
        sphericalRef.current.targetDistance + zoomDelta,
        CAMERA.minDistance,
        CAMERA.maxDistance
      );

      // Calcul dynamique du niveau d'agrégation selon la distance
      const deg = clusterDegreesForCamera(sphericalRef.current.targetDistance);
      if (Math.abs(deg - lastReportedDegrees.current) > 0.05) {
        lastReportedDegrees.current = deg;
        setDegrees(deg);
      }
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    const handleResize = () => {
      if (!containerRef.current) return;
      width = containerRef.current.clientWidth;
      height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Animation 60 FPS
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();
      const delta = clock.getDelta();
      const now = Date.now();

      if (!isDraggingRef.current) {
        sphericalRef.current.targetTheta += velocityRef.current.theta;
        sphericalRef.current.targetPhi = clamp(
          sphericalRef.current.targetPhi + velocityRef.current.phi,
          0.12,
          Math.PI - 0.12
        );
        velocityRef.current.theta *= CAMERA.damping;
        velocityRef.current.phi *= CAMERA.damping;

        if (now - lastInteractionTimeRef.current > 3500) {
          sphericalRef.current.targetTheta += CAMERA.autoRotate.speed * delta;
        }
      }

      const s = sphericalRef.current;
      s.theta += (s.targetTheta - s.theta) * 0.1;
      s.phi += (s.targetPhi - s.phi) * 0.1;
      s.distance += (s.targetDistance - s.distance) * 0.1;

      const sinPhi = Math.sin(s.phi);
      camera.position.x = s.distance * sinPhi * Math.sin(s.theta);
      camera.position.y = s.distance * Math.cos(s.phi);
      camera.position.z = s.distance * sinPhi * Math.cos(s.theta);
      camera.lookAt(0, 0, 0);

      const dpr = renderer.getPixelRatio();
      if (holographicEarthRef.current) holographicEarthRef.current.update(elapsedTime);
      if (orbitLayerRef.current) orbitLayerRef.current.update(elapsedTime, delta);
      if (starfieldRef.current) starfieldRef.current.update(elapsedTime);
      if (conflictLayerRef.current) conflictLayerRef.current.update(elapsedTime, delta, fov, height, dpr);

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      dom.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);

      holographicEarth.dispose();
      orbitLayer.dispose();
      starfield.dispose();
      conflictLayer.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [hover, select, setCountry, setHoveredCountry, setDegrees]);

  // Synchronisation des foyers
  useEffect(() => {
    if (conflictLayerRef.current) {
      conflictLayerRef.current.setClusters(clusters);
    }
  }, [clusters]);

  // Synchronisation sélection et survol
  useEffect(() => {
    if (conflictLayerRef.current) {
      conflictLayerRef.current.setSelected(selected?.id || null, hoveredId);
    }
  }, [selected, hoveredId]);

  // Recentrage sur requête externe
  useEffect(() => {
    if (!focusRequest) return;
    const latRad = (focusRequest.lat * Math.PI) / 180;
    const lonRad = (focusRequest.lon * Math.PI) / 180;

    let targetTheta = -lonRad - Math.PI / 2;
    const targetPhi = clamp(Math.PI / 2 - latRad, 0.15, Math.PI - 0.15);

    const currentTheta = sphericalRef.current.theta;
    const twoPi = Math.PI * 2;
    targetTheta = currentTheta + ((((targetTheta - currentTheta) % twoPi) + twoPi * 1.5) % twoPi) - Math.PI;

    sphericalRef.current.targetTheta = targetTheta;
    sphericalRef.current.targetPhi = targetPhi;
    sphericalRef.current.targetDistance = Math.min(sphericalRef.current.distance, 1.85);
    lastInteractionTimeRef.current = Date.now();
  }, [focusRequest]);

  return <div ref={containerRef} className="relative h-full w-full select-none" />;
}
