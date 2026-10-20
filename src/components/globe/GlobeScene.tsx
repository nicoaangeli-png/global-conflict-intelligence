'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CAMERA, GLOBE } from '@/lib/config/visual';
import { clusterDegreesForCamera } from '@/lib/clustering/cluster';
import { latLonToCameraAngles, vector3ToLatLon } from '@/lib/geo/latlon';
import { countryAt } from '@/lib/geo/world';
import { loadWorld } from '@/lib/geo/referentials';
import { HolographicEarth } from './HolographicEarth';
import { OrbitLayer } from './OrbitLayer';
import { Starfield } from './Starfield';
import { ConflictLayer } from '../conflicts/ConflictLayer';
import { FeedLayer } from './FeedLayer';
import { MobileLayer } from './MobileLayer';
import { vehicleOf } from '../feeds/vehicleModel';
import { ReferenceLayers } from './ReferenceLayers';
import { LayersMenu } from '../layers/LayersMenu';
import { LAYER_ORDER, sanctionsByCountry } from '../layers/layerModel';
import { useIntelStore } from '@/store/useIntelStore';
import { tr } from '@/lib/i18n';
import type { LiveItem } from '@/types/feeds';
import { itemsForTheme, type ThemeKey } from '../feeds/feedModel';
import { isPointPrecise } from '../feeds/conflictModel';

/**
 * Points de flux visibles pour un thème (« conflict » : aucun, « all » : l'actualité).
 * Les mobiles militaires ont leur propre calque (`MobileLayer`), visible sur tous les thèmes.
 */
function feedItemsFor(theme: ThemeKey, feeds: LiveItem[], allWeather: boolean): LiveItem[] {
  return itemsForTheme(feeds, theme, Date.now(), { allWeather }).filter((item) => item.category !== 'military');
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function GlobeScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const holographicEarthRef = useRef<HolographicEarth | null>(null);
  const orbitLayerRef = useRef<OrbitLayer | null>(null);
  const starfieldRef = useRef<Starfield | null>(null);
  const conflictLayerRef = useRef<ConflictLayer | null>(null);
  const feedLayerRef = useRef<FeedLayer | null>(null);
  const referenceLayersRef = useRef<ReferenceLayers | null>(null);
  const mobileLayerRef = useRef<MobileLayer | null>(null);

  const clusters = useIntelStore((s) => s.clusters);
  const selected = useIntelStore((s) => s.selected);
  const hoveredId = useIntelStore((s) => s.hoveredId);
  const focusRequest = useIntelStore((s) => s.focusRequest);
  const select = useIntelStore((s) => s.select);
  const hover = useIntelStore((s) => s.hover);
  const setDegrees = useIntelStore((s) => s.setDegrees);
  const setCountry = useIntelStore((s) => s.setCountry);
  const setHoveredCountry = useIntelStore((s) => s.setHoveredCountry);
  const theme = useIntelStore((s) => s.theme);
  const feeds = useIntelStore((s) => s.feeds);
  const selectedFeedId = useIntelStore((s) => s.selectedFeedItem?.id ?? null);
  const hoveredFeedId = useIntelStore((s) => s.hoveredFeedId);
  const locale = useIntelStore((s) => s.locale);
  const weatherAll = useIntelStore((s) => s.weatherAll);
  const mobilesOn = useIntelStore((s) => s.mobilesOn);
  const layersOn = useIntelStore((s) => s.layersOn);
  const layers = useIntelStore((s) => s.layers);
  const selectedLayer = useIntelStore((s) => s.selectedLayerFeature);
  const hoveredLayer = useIntelStore((s) => s.hoveredLayerFeature);

  const sphericalRef = useRef<{
    distance: number;
    targetDistance: number;
    theta: number;
    targetTheta: number;
    phi: number;
    targetPhi: number;
  }>({
    distance: CAMERA.initial.distance,
    targetDistance: CAMERA.initial.distance,
    theta: CAMERA.initial.theta,
    targetTheta: CAMERA.initial.theta,
    phi: CAMERA.initial.phi,
    targetPhi: CAMERA.initial.phi,
  });

  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const totalDragDistRef = useRef(0);
  const previousMousePosRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ theta: 0, phi: 0 });
  const lastInteractionTimeRef = useRef(Date.now());
  const lastReportedDegrees = useRef(0);
  const debounceZoomTimer = useRef<ReturnType<typeof setTimeout>>(null);

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

    // Calques de référence (installations, câbles, sanctions) : sous les foyers et les flux.
    const referenceLayers = new ReferenceLayers(GLOBE.radius);
    globeGroup.add(referenceLayers.group);
    referenceLayersRef.current = referenceLayers;

    // Calque des flux mondiaux : au-dessus des foyers, sans toucher au rendu de la Terre.
    const feedLayer = new FeedLayer(GLOBE.radius);
    globeGroup.add(feedLayer.group);
    feedLayerRef.current = feedLayer;

    // Mobiles militaires (aéronefs, navires) et leurs trajets : au-dessus de tout le reste.
    const mobileLayer = new MobileLayer(GLOBE.radius);
    globeGroup.add(mobileLayer.group);
    mobileLayerRef.current = mobileLayer;

    /** Foyer de conflit sous le pointeur, seulement si son calque est allumé. */
    const conflictHit = (rect: DOMRect) =>
      conflictLayerRef.current?.group.visible ? conflictLayerRef.current.hitTest(camera, mouse, rect.width, rect.height) : null;
    // Un mobile (au-dessus) prime sur un point de flux.
    const feedHit = (rect: DOMRect) =>
      mobileLayerRef.current?.hitTest(camera, mouse, rect.width, rect.height) ?? feedLayerRef.current?.hitTest(camera, mouse, rect.width, rect.height) ?? null;
    /** Élément d'un calque de référence allumé (~20 000 segments de câbles : ~1 ms par test). */
    const layerHit = (rect: DOMRect) => referenceLayersRef.current?.hitTest(camera, mouse, rect.width, rect.height, true) ?? null;

    // Raycasting & picking analytique exact sur la sphère terrestre
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), GLOBE.radius);
    const hitPoint = new THREE.Vector3();
    const worldIndexPromise = loadWorld();
    let activePointerId: number | null = null;

    const updatePointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      return rect;
    };

    const onMouseDown = (e: PointerEvent) => {
      if (!e.isPrimary || activePointerId !== null || (e.button !== 0 && e.button !== 2)) return;
      activePointerId = e.pointerId;
      renderer.domElement.setPointerCapture(e.pointerId);
      updatePointer(e);
      isDraggingRef.current = true;
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      totalDragDistRef.current = 0;
      previousMousePosRef.current = { x: e.clientX, y: e.clientY };
      velocityRef.current = { theta: 0, phi: 0 };
      lastInteractionTimeRef.current = Date.now();
    };

    const onMouseMove = (e: PointerEvent) => {
      if (!e.isPrimary || (activePointerId !== null && activePointerId !== e.pointerId)) return;
      const rect = updatePointer(e);

      if (isDraggingRef.current) {
        const deltaX = e.clientX - previousMousePosRef.current.x;
        const deltaY = e.clientY - previousMousePosRef.current.y;
        totalDragDistRef.current += Math.hypot(deltaX, deltaY);

        // Rotation fluide proportionnelle à la distance caméra (plus on est près, plus le contrôle est fin)
        const scale = (sphericalRef.current.targetDistance / CAMERA.initial.distance) * CAMERA.rotateSpeed;
        const vTheta = -deltaX * scale;
        const vPhi = -deltaY * scale;

        // Amortissement de vélocité
        velocityRef.current = {
          theta: velocityRef.current.theta * 0.35 + vTheta * 0.65,
          phi: velocityRef.current.phi * 0.35 + vPhi * 0.65,
        };

        sphericalRef.current.targetTheta += vTheta;
        sphericalRef.current.targetPhi = clamp(
          sphericalRef.current.targetPhi + vPhi,
          0.15,
          Math.PI - 0.15
        );

        previousMousePosRef.current = { x: e.clientX, y: e.clientY };
        lastInteractionTimeRef.current = Date.now();
        hover(null);
        setHoveredCountry(null);
        useIntelStore.getState().hoverFeed(null);
        useIntelStore.getState().hoverLayerFeature(null);
      } else {
        if (e.target !== renderer.domElement || Math.abs(mouse.x) > 1 || Math.abs(mouse.y) > 1) {
          container.style.cursor = 'default';
          hover(null);
          setHoveredCountry(null);
          // Le survol d'une ligne du fil (hors canevas) garde la main sur le point surligné.
          if (e.target === renderer.domElement) useIntelStore.getState().hoverFeed(null);
          useIntelStore.getState().hoverLayerFeature(null);
          return;
        }
        raycaster.setFromCamera(mouse, camera);
        const hit = conflictHit(rect);
        const itemHit = hit ? null : feedHit(rect);
        const refHit = hit || itemHit ? null : layerHit(rect);
        useIntelStore.getState().hoverFeed(itemHit?.id ?? null);
        useIntelStore.getState().hoverLayerFeature(refHit);
        if (hit || itemHit || refHit) {
          container.style.cursor = 'pointer';
          hover(hit?.id ?? null);
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

    const onMouseUp = (e: PointerEvent) => {
      if (activePointerId !== e.pointerId) return;
      const rect = updatePointer(e);
      const wasDragging = isDraggingRef.current;
      const totalDist = totalDragDistRef.current + Math.hypot(
        e.clientX - previousMousePosRef.current.x,
        e.clientY - previousMousePosRef.current.y,
      );
      isDraggingRef.current = false;
      activePointerId = null;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);

      // Si l'utilisateur a glissé de plus de 5px au total, c'était une rotation du globe.
      // On ne déclenche JAMAIS de clic accidentel lors du relâchement !
      if (!wasDragging || totalDist > 5 || e.button !== 0 || Math.abs(mouse.x) > 1 || Math.abs(mouse.y) > 1) {
        return;
      }

      // Clic stationnaire intentionnel (totalDist <= 5)
      raycaster.setFromCamera(mouse, camera);
      const hit = conflictHit(rect);
      const itemHit = hit ? null : feedHit(rect);
      const refHit = hit || itemHit ? null : layerHit(rect);
      if (hit) {
        void select(hit);
      } else if (itemHit) {
        useIntelStore.getState().selectFeedItem(itemHit);
      } else if (refHit) {
        useIntelStore.getState().selectLayerFeature(refHit);
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
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (activePointerId !== e.pointerId) return;
      activePointerId = null;
      isDraggingRef.current = false;
      velocityRef.current = { theta: 0, phi: 0 };
      hover(null);
      setHoveredCountry(null);
      container.style.cursor = 'default';
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInteractionTimeRef.current = Date.now();

      const isPinch = e.ctrlKey;
      const isHorizontalTrackpad = Math.abs(e.deltaX) > Math.abs(e.deltaY);

      if (isPinch) {
        // Pincement Trackpad macOS (Pinch to Zoom) : progressif et doux
        const factor = Math.exp(e.deltaY * 0.005);
        sphericalRef.current.targetDistance = clamp(
          sphericalRef.current.targetDistance * factor,
          CAMERA.minDistance,
          CAMERA.maxDistance
        );
      } else if (isHorizontalTrackpad || (Math.abs(e.deltaX) > 2 && Math.abs(e.deltaY) < 30)) {
        // Balayage à 2 doigts sur trackpad (Trackpad Pan/Rotate) : tourne le globe, NE ZOOME PAS !
        const rotScale = 0.0022;
        sphericalRef.current.targetTheta += -e.deltaX * rotScale;
        sphericalRef.current.targetPhi = clamp(
          sphericalRef.current.targetPhi + -e.deltaY * rotScale,
          0.15,
          Math.PI - 0.15
        );
        velocityRef.current = { theta: 0, phi: 0 };
      } else {
        // Molette de souris classique ou scroll vertical trackpad franc
        // Zoom exponentiel doux sans saut brusque
        const boundedDelta = clamp(e.deltaY, -60, 60);
        const zoomFactor = Math.exp(boundedDelta * 0.0016);
        sphericalRef.current.targetDistance = clamp(
          sphericalRef.current.targetDistance * zoomFactor,
          CAMERA.minDistance,
          CAMERA.maxDistance
        );
      }

      // Débouncage de la mise à jour d'agrégation réseau (évite tout freeze)
      if (debounceZoomTimer.current) clearTimeout(debounceZoomTimer.current);
      debounceZoomTimer.current = setTimeout(() => {
        const deg = clusterDegreesForCamera(sphericalRef.current.targetDistance);
        if (Math.abs(deg - lastReportedDegrees.current) > 0.05) {
          lastReportedDegrees.current = deg;
          setDegrees(deg);
        }
      }, 180);
    };

    const dom = renderer.domElement;
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', onMouseDown);
    window.addEventListener('pointermove', onMouseMove);
    window.addEventListener('pointerup', onMouseUp);
    dom.addEventListener('pointercancel', onPointerCancel);
    dom.addEventListener('lostpointercapture', onPointerCancel);
    dom.addEventListener('wheel', onWheel, { passive: false });

    // Empêche le menu contextuel par clic droit pour permettre la rotation fluide
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    dom.addEventListener('contextmenu', onContextMenu);

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
          0.15,
          Math.PI - 0.15
        );
        velocityRef.current.theta *= CAMERA.damping;
        velocityRef.current.phi *= CAMERA.damping;

        // Auto-rotation lente uniquement après 25 secondes d'inactivité totale
        if (now - lastInteractionTimeRef.current > 25000) {
          sphericalRef.current.targetTheta += CAMERA.autoRotate.speed * delta * 0.4;
        }
      }

      const s = sphericalRef.current;
      s.theta += (s.targetTheta - s.theta) * 0.12;
      s.phi += (s.targetPhi - s.phi) * 0.12;
      s.distance += (s.targetDistance - s.distance) * 0.12;

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
      if (feedLayerRef.current) feedLayerRef.current.update(elapsedTime, dpr);
      if (mobileLayerRef.current) mobileLayerRef.current.update(dpr, width, height);
      if (referenceLayersRef.current) referenceLayersRef.current.update(dpr);

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      dom.removeEventListener('pointerdown', onMouseDown);
      window.removeEventListener('pointermove', onMouseMove);
      window.removeEventListener('pointerup', onMouseUp);
      dom.removeEventListener('pointercancel', onPointerCancel);
      dom.removeEventListener('lostpointercapture', onPointerCancel);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', handleResize);
      if (debounceZoomTimer.current) clearTimeout(debounceZoomTimer.current);

      holographicEarth.dispose();
      orbitLayer.dispose();
      starfield.dispose();
      conflictLayer.dispose();
      feedLayer.dispose();
      referenceLayers.dispose();
      mobileLayer.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [hover, select, setCountry, setHoveredCountry, setDegrees]);

  // Synchronisation des foyers
  useEffect(() => {
    if (conflictLayerRef.current) {
      // Un foyer localisé au niveau pays/région n'est pas dessiné comme un point précis
      // (il reste dans les compteurs et la liste des zones, avec sa mention).
      conflictLayerRef.current.setClusters(clusters.filter(isPointPrecise));
    }
  }, [clusters]);

  // Calques par thème : « Conflits » n'allume que les foyers, une catégorie que ses points.
  useEffect(() => {
    if (conflictLayerRef.current) conflictLayerRef.current.group.visible = theme === 'all' || theme === 'conflict';
    const layer = feedLayerRef.current;
    if (!layer) return;
    const apply = () => layer.setItems(feedItemsFor(theme, feeds, weatherAll));
    apply();
    // Les halos « < 2 h » et l'éclat suivent l'âge réel : recalcul chaque minute.
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, [theme, feeds, weatherAll]);

  // Calques de référence : visibilité (éteints par défaut) et données chargées à la demande.
  useEffect(() => {
    const ref = referenceLayersRef.current;
    if (!ref) return;
    for (const id of LAYER_ORDER) ref.setVisible(id, layersOn[id] && Boolean(layers[id]?.data?.features.length));
  }, [layersOn, layers]);

  const nuclearData = layers.nuclear_plants?.data ?? null;
  const basesData = layers.military_bases?.data ?? null;
  const cablesData = layers.submarine_cables?.data ?? null;
  const sanctionsData = layers.sanctions?.data ?? null;
  useEffect(() => {
    referenceLayersRef.current?.setFeatures('nuclear_plants', nuclearData?.features ?? null);
  }, [nuclearData]);
  useEffect(() => {
    referenceLayersRef.current?.setFeatures('military_bases', basesData?.features ?? null);
  }, [basesData]);
  useEffect(() => {
    referenceLayersRef.current?.setFeatures('submarine_cables', cablesData?.features ?? null);
  }, [cablesData]);
  useEffect(() => {
    if (!sanctionsData?.features.length) return;
    let cancelled = false;
    const isos = new Set(sanctionsByCountry(sanctionsData.features).keys());
    // Les contours viennent du même référentiel Natural Earth que le globe.
    loadWorld()
      .then((world) => {
        if (!cancelled) referenceLayersRef.current?.setSanctions(isos, world);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sanctionsData]);

  useEffect(() => {
    referenceLayersRef.current?.setHighlight(
      selectedLayer ? { layerId: selectedLayer.layerId, id: selectedLayer.feature.id } : null,
      hoveredLayer ? { layerId: hoveredLayer.layerId, id: hoveredLayer.feature.id } : null,
    );
  }, [selectedLayer, hoveredLayer, nuclearData, basesData, cablesData]);

  // Mobiles militaires : sur tous les thèmes selon le menu « Calques » (allumés par défaut) ;
  // l'onglet Militaire les montre toujours. Recalcul à chaque rafraîchissement (15 s).
  useEffect(() => {
    const layer = mobileLayerRef.current;
    if (!layer) return;
    const forced = theme === 'military';
    const apply = () =>
      layer.setItems(
        feeds.filter((item) => {
          const kind = vehicleOf(item);
          return kind !== null && ((forced && kind !== 'merchant') || mobilesOn[kind]);
        }),
      );
    apply();
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, [theme, feeds, mobilesOn]);

  useEffect(() => {
    mobileLayerRef.current?.setHighlight(selectedFeedId, hoveredFeedId);
  }, [selectedFeedId, hoveredFeedId, feeds, theme, mobilesOn]);

  useEffect(() => {
    feedLayerRef.current?.setHighlight(selectedFeedId, hoveredFeedId);
  }, [selectedFeedId, hoveredFeedId, feeds, theme]);

  // Synchronisation sélection et survol
  useEffect(() => {
    if (conflictLayerRef.current) {
      conflictLayerRef.current.setSelected(selected?.id || null, hoveredId);
    }
  }, [selected, hoveredId]);

  // Recentrage sur requête externe sans coup de zoom violent
  useEffect(() => {
    if (!focusRequest) return;
    const angles = latLonToCameraAngles(focusRequest.lat, focusRequest.lon);
    let targetTheta = angles.theta;
    const targetPhi = clamp(angles.phi, 0.15, Math.PI - 0.15);

    const currentTheta = sphericalRef.current.theta;
    const twoPi = Math.PI * 2;
    targetTheta = currentTheta + ((((targetTheta - currentTheta) % twoPi) + twoPi * 1.5) % twoPi) - Math.PI;

    sphericalRef.current.targetTheta = targetTheta;
    sphericalRef.current.targetPhi = targetPhi;
    velocityRef.current = { theta: 0, phi: 0 };
    // Préserve le niveau de zoom choisi par l'utilisateur (ne force plus un zoom brutal à 1.85)
    lastInteractionTimeRef.current = Date.now();
  }, [focusRequest]);

  // Fonctions de contrôle manuel pour la barre d'outils tactique
  const handleZoomIn = () => {
    sphericalRef.current.targetDistance = clamp(
      sphericalRef.current.targetDistance * 0.78,
      CAMERA.minDistance,
      CAMERA.maxDistance
    );
    lastInteractionTimeRef.current = Date.now();
    const deg = clusterDegreesForCamera(sphericalRef.current.targetDistance);
    setDegrees(deg);
  };

  const handleZoomOut = () => {
    sphericalRef.current.targetDistance = clamp(
      sphericalRef.current.targetDistance * 1.28,
      CAMERA.minDistance,
      CAMERA.maxDistance
    );
    lastInteractionTimeRef.current = Date.now();
    const deg = clusterDegreesForCamera(sphericalRef.current.targetDistance);
    setDegrees(deg);
  };

  const handleResetView = () => {
    sphericalRef.current.targetDistance = CAMERA.initial.distance;
    sphericalRef.current.targetTheta = CAMERA.initial.theta;
    sphericalRef.current.targetPhi = CAMERA.initial.phi;
    velocityRef.current = { theta: 0, phi: 0 };
    lastInteractionTimeRef.current = Date.now();
    setDegrees(2.4);
  };

  const handleNorthUp = () => {
    sphericalRef.current.targetPhi = Math.PI / 2;
    velocityRef.current.phi = 0;
    lastInteractionTimeRef.current = Date.now();
  };

  return (
    <div className="relative h-full w-full select-none">
      <div ref={containerRef} className="h-full w-full" />

      {/* Contrôles de caméra : dock bas-centre (aucune collision avec les colonnes latérales). */}
      <div className="globe-dock" role="group" aria-label={tr(locale, 'Contrôles du globe', 'Globe controls')}>
        <button type="button" onClick={handleZoomIn} title={tr(locale, 'Zoom avant', 'Zoom in')} aria-label={tr(locale, 'Zoom avant', 'Zoom in')}>
          +
        </button>
        <button type="button" onClick={handleZoomOut} title={tr(locale, 'Zoom arrière', 'Zoom out')} aria-label={tr(locale, 'Zoom arrière', 'Zoom out')}>
          −
        </button>
        <button type="button" onClick={handleNorthUp} title={tr(locale, 'Nord en haut', 'North up')} aria-label={tr(locale, 'Nord en haut', 'North up')}>
          N
        </button>
        <button type="button" onClick={handleResetView} title={tr(locale, 'Vue globale initiale', 'Reset global view')} aria-label={tr(locale, 'Vue globale initiale', 'Reset global view')}>
          ⟳
        </button>
        <LayersMenu />
      </div>
    </div>
  );
}
