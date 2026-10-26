'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CAMERA, GLOBE } from '@/lib/config/visual';
import { vector3ToLatLon } from '@/lib/geo/latlon';
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
import { GlobeGesture, globeFieldOfView, globeFrameDelta, globeMarkerBudget, globeQuality } from '@/lib/globeQuality';
import { GlobeCameraController } from './GlobeCamera';
import { CameraLayer } from './CameraLayer';

/**
 * Points de flux visibles pour un thème (« conflict » : aucun, « all » : l'actualité).
 * Les mobiles militaires ont leur propre calque (`MobileLayer`), visible sur tous les thèmes.
 */
function feedItemsFor(theme: ThemeKey, feeds: LiveItem[], allWeather: boolean): LiveItem[] {
  return itemsForTheme(feeds, theme, Date.now(), { allWeather }).filter((item) => item.category !== 'military');
}

export function GlobeScene() {
  const [quality, setQuality] = useState(() => globeQuality({}));
  const qualityRef = useRef(quality);
  const containerRef = useRef<HTMLDivElement>(null);
  const holographicEarthRef = useRef<HolographicEarth | null>(null);
  const orbitLayerRef = useRef<OrbitLayer | null>(null);
  const starfieldRef = useRef<Starfield | null>(null);
  const conflictLayerRef = useRef<ConflictLayer | null>(null);
  const feedLayerRef = useRef<FeedLayer | null>(null);
  const referenceLayersRef = useRef<ReferenceLayers | null>(null);
  const mobileLayerRef = useRef<MobileLayer | null>(null);
  const cameraLayerRef = useRef<CameraLayer | null>(null);

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
  const camerasOn = useIntelStore((s) => s.camerasOn);
  const cameras = useIntelStore((s) => s.cameras);
  const selectedCameraId = useIntelStore((s) => s.selectedCamera?.id ?? null);
  const degrees = useIntelStore((s) => s.degrees);
  const budgetSelectedId = Number.isFinite(quality.markerLimit) ? selected?.id : null;
  const budgetHoveredId = Number.isFinite(quality.markerLimit) ? hoveredId : null;
  const budgetSelectedFeedId = Number.isFinite(quality.markerLimit) ? selectedFeedId : null;
  const budgetHoveredFeedId = Number.isFinite(quality.markerLimit) ? hoveredFeedId : null;

  // Caméra orbitale (état, inertie, zoom) : logique pure dans GlobeCamera.ts.
  const cameraRef = useRef<GlobeCameraController | null>(null);
  cameraRef.current ??= new GlobeCameraController();
  const lastReportedDegrees = useRef(0);
  const debounceZoomTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!containerRef.current || !cameraRef.current) return;
    const container = containerRef.current;
    const orbit = cameraRef.current;
    let width = Math.max(1, container.clientWidth);
    let height = Math.max(1, container.clientHeight);
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointerQuery = window.matchMedia('(pointer: coarse)');
    const readQuality = () => globeQuality({
      coarsePointer: pointerQuery.matches,
      shortSide: Math.min(window.innerWidth, window.innerHeight),
      cores: navigator.hardwareConcurrency,
      memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      reducedMotion: motionQuery.matches,
    });
    qualityRef.current = readQuality();
    setQuality(qualityRef.current);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x010409, 0.002);

    const fov = globeFieldOfView(CAMERA.fov, width, height);
    const camera = new THREE.PerspectiveCamera(fov, width / height, CAMERA.near, CAMERA.far);
    camera.position.set(0, 0, CAMERA.initial.distance);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: qualityRef.current.effects,
      powerPreference: qualityRef.current.effects ? 'high-performance' : 'low-power',
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityRef.current.maxDpr));
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

    const cameraLayer = new CameraLayer(GLOBE.radius);
    globeGroup.add(cameraLayer.group);
    cameraLayerRef.current = cameraLayer;

    // Calque des flux mondiaux : au-dessus des foyers, sans toucher au rendu de la Terre.
    const feedLayer = new FeedLayer(GLOBE.radius);
    globeGroup.add(feedLayer.group);
    feedLayerRef.current = feedLayer;

    // Mobiles militaires (aéronefs, navires) et leurs trajets : au-dessus de tout le reste.
    const mobileLayer = new MobileLayer(GLOBE.radius);
    globeGroup.add(mobileLayer.group);
    mobileLayerRef.current = mobileLayer;

    const applyQuality = () => {
      const next = readQuality();
      qualityRef.current = next;
      setQuality(next);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, next.maxDpr));
      cameraLayer.setPixelRatio(renderer.getPixelRatio());
      orbitLayer.group.visible = next.effects;
      starfield.group.traverse((object) => {
        if (!(object instanceof THREE.Points)) return;
        object.geometry.setDrawRange(0, Math.floor(object.geometry.getAttribute('position').count * next.starFraction));
        const material = object.material;
        if (material instanceof THREE.ShaderMaterial && material.uniforms.uPixelRatio) {
          material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
        }
      });
      holographicEarth.group.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial && object.material.uniforms.uPulse) {
          object.visible = next.effects;
        }
      });
      conflictLayer.group.traverse((object) => {
        if (object instanceof THREE.Points) object.visible = next.effects;
      });
      if (next.reducedMotion) orbit.stop();
    };
    applyQuality();
    motionQuery.addEventListener('change', applyQuality);
    pointerQuery.addEventListener('change', applyQuality);

    /** Foyer de conflit sous le pointeur, seulement si son calque est allumé. */
    const conflictHit = (rect: DOMRect) =>
      conflictLayerRef.current?.group.visible ? conflictLayerRef.current.hitTest(camera, mouse, rect.width, rect.height) : null;
    // Un mobile (au-dessus) prime sur un point de flux.
    const feedHit = (rect: DOMRect) =>
      mobileLayerRef.current?.hitTest(camera, mouse, rect.width, rect.height) ?? feedLayerRef.current?.hitTest(camera, mouse, rect.width, rect.height) ?? null;
    /** Élément d'un calque de référence allumé (~20 000 segments de câbles : ~1 ms par test). */
    const layerHit = (rect: DOMRect) => referenceLayersRef.current?.hitTest(camera, mouse, rect.width, rect.height, true) ?? null;
    const cameraHit = (rect: DOMRect) => cameraLayerRef.current?.hitTest(camera, mouse, rect.width, rect.height, globeGroup.matrixWorld, camera.position) ?? null;

    // Raycasting & picking analytique exact sur la sphère terrestre
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), GLOBE.radius);
    const hitPoint = new THREE.Vector3();
    const worldIndexPromise = loadWorld();
    const gesture = new GlobeGesture();
    let disposed = false;
    let interactionVersion = 0;
    let hoverVersion = 0;
    const reportZoom = () => {
      if (debounceZoomTimer.current) clearTimeout(debounceZoomTimer.current);
      debounceZoomTimer.current = setTimeout(() => {
        const degrees = orbit.clusterDegrees;
        if (Math.abs(degrees - lastReportedDegrees.current) > 0.05) {
          lastReportedDegrees.current = degrees;
          setDegrees(degrees);
        }
      }, 180);
    };

    const clearHover = () => {
      hoverVersion++;
      hover(null);
      setHoveredCountry(null);
      useIntelStore.getState().hoverFeed(null);
      useIntelStore.getState().hoverLayerFeature(null);
      container.style.cursor = 'default';
    };

    const updatePointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      return rect;
    };

    const onMouseDown = (e: PointerEvent) => {
      if ((e.button !== 0 && e.button !== 2) || (e.pointerType === 'mouse' && gesture.active)) return;
      interactionVersion++;
      clearHover();
      gesture.down(e.pointerId, e.clientX, e.clientY);
      renderer.domElement.setPointerCapture(e.pointerId);
      updatePointer(e);
      orbit.beginDrag();
    };

    const onMouseMove = (e: PointerEvent) => {
      if (gesture.active && !gesture.has(e.pointerId)) return;
      if (!gesture.active && (e.pointerType === 'touch' || !e.isPrimary)) return;
      const currentHover = ++hoverVersion;
      const rect = updatePointer(e);

      if (gesture.active) {
        const movement = gesture.move(e.pointerId, e.clientX, e.clientY);
        if (!movement) return;
        const { deltaX, deltaY, previousSpan, span } = movement;
        if (span > 0 || previousSpan > 0) {
          orbit.pinch(previousSpan, span);
          reportZoom();
          return;
        }

        orbit.drag(deltaX, deltaY);
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
        const camHit = hit || itemHit ? null : cameraHit(rect);
        const refHit = hit || itemHit || camHit ? null : layerHit(rect);
        useIntelStore.getState().hoverFeed(itemHit?.id ?? null);
        useIntelStore.getState().hoverLayerFeature(refHit);
        if (hit || itemHit || refHit || camHit) {
          container.style.cursor = 'pointer';
          hover(hit?.id ?? null);
          setHoveredCountry(null);
        } else {
          hover(null);

          // Inspection pays au survol via intersection analytique sur la sphère
          if (raycaster.ray.intersectSphere(earthSphere, hitPoint)) {
            const geo = vector3ToLatLon(hitPoint);
            worldIndexPromise.then((w) => {
              if (disposed || currentHover !== hoverVersion || gesture.active) return;
              const c = countryAt(w, geo.lat, geo.lon);
              if (c) {
                container.style.cursor = 'pointer';
                setHoveredCountry({ name: c.name, iso: c.iso, lat: geo.lat, lon: geo.lon });
              } else {
                container.style.cursor = 'default';
                setHoveredCountry(null);
              }
            }).catch(() => undefined);
          } else {
            container.style.cursor = 'default';
            setHoveredCountry(null);
          }
        }
      }
    };

    const onMouseUp = (e: PointerEvent) => {
      if (!gesture.has(e.pointerId)) return;
      const rect = updatePointer(e);
      const tap = gesture.end(e.pointerId, e.clientX, e.clientY);
      orbit.dragging = gesture.active;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);

      // Si l'utilisateur a glissé de plus de 5px au total, c'était une rotation du globe.
      // On ne déclenche JAMAIS de clic accidentel lors du relâchement !
      if (!tap || e.button !== 0 || Math.abs(mouse.x) > 1 || Math.abs(mouse.y) > 1) {
        return;
      }

      // Clic stationnaire intentionnel (totalDist <= 5)
      raycaster.setFromCamera(mouse, camera);
      const hit = conflictHit(rect);
      const itemHit = hit ? null : feedHit(rect);
      const camHit = hit || itemHit ? null : cameraHit(rect);
      const refHit = hit || itemHit || camHit ? null : layerHit(rect);
      if (hit) {
        void select(hit);
      } else if (itemHit) {
        useIntelStore.getState().selectFeedItem(itemHit);
      } else if (camHit) {
        useIntelStore.getState().selectCamera(camHit);
      } else if (refHit) {
        useIntelStore.getState().selectLayerFeature(refHit);
      } else {
        // Clic sur un pays pour ouvrir la fiche détaillée Pentagone
        if (raycaster.ray.intersectSphere(earthSphere, hitPoint)) {
          const geo = vector3ToLatLon(hitPoint);
          const selectionVersion = interactionVersion;
          worldIndexPromise.then((w) => {
            if (disposed || selectionVersion !== interactionVersion) return;
            const c = countryAt(w, geo.lat, geo.lon);
            if (c) {
              setCountry({ name: c.name, iso: c.iso, lat: geo.lat, lon: geo.lon });
            } else {
              setCountry(null);
            }
          }).catch(() => undefined);
        } else {
          setCountry(null);
        }
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (!gesture.has(e.pointerId)) return;
      interactionVersion++;
      gesture.end(e.pointerId, e.clientX, e.clientY, true);
      orbit.dragging = gesture.active;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
      orbit.stop();
      clearHover();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbit.wheel(e);
      // Débouncage de la mise à jour d'agrégation réseau (évite tout freeze)
      reportZoom();
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
      width = Math.max(1, containerRef.current.clientWidth);
      height = Math.max(1, containerRef.current.clientHeight);
      camera.aspect = width / height;
      camera.fov = globeFieldOfView(CAMERA.fov, width, height);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      applyQuality();
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    let animationFrameId: number | null = null;
    let lastFrame: number | null = null;
    let elapsedTime = 0;

    const animate = (timestamp: number) => {
      if (disposed || document.hidden) return;
      animationFrameId = requestAnimationFrame(animate);
      const profile = qualityRef.current;
      const delta = globeFrameDelta(timestamp, lastFrame, profile.fps);
      if (delta === null) return;
      lastFrame = timestamp;
      if (!profile.reducedMotion) elapsedTime += delta;
      orbit.step(delta, { reducedMotion: profile.reducedMotion });
      orbit.applyTo(camera);

      const dpr = renderer.getPixelRatio();
      if (holographicEarthRef.current) holographicEarthRef.current.update(elapsedTime);
      if (profile.effects) orbitLayer.update(elapsedTime, delta);
      if (profile.starFraction > 0) starfield.update(elapsedTime);
      if (conflictLayerRef.current) conflictLayerRef.current.update(elapsedTime, profile.reducedMotion ? 1 : delta, fov, height, dpr);
      if (feedLayerRef.current) feedLayerRef.current.update(elapsedTime, dpr);
      if (mobileLayerRef.current) mobileLayerRef.current.update(dpr, width, height, performance.now() + (profile.reducedMotion ? 60_000 : 0));
      if (profile.reducedMotion) mobileLayer.group.traverse((object) => {
        if (object instanceof THREE.LineSegments && object.material instanceof THREE.ShaderMaterial && object.material.uniforms.uTime) {
          object.material.uniforms.uTime.value = elapsedTime;
        }
      });
      if (referenceLayersRef.current) referenceLayersRef.current.update(dpr);

      renderer.render(scene, camera);
    };

    const pauseInteraction = () => {
      interactionVersion++;
      const pointerIds = gesture.reset();
      for (const pointerId of pointerIds) {
        if (dom.hasPointerCapture(pointerId)) dom.releasePointerCapture(pointerId);
      }
      orbit.dragging = false;
      orbit.stop();
      clearHover();
    };
    const onVisibilityChange = () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
      lastFrame = null;
      pauseInteraction();
      orbit.touch();
      if (!document.hidden) animationFrameId = requestAnimationFrame(animate);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', pauseInteraction);
    if (!document.hidden) animationFrameId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      gesture.reset();
      orbit.dragging = false;
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      motionQuery.removeEventListener('change', applyQuality);
      pointerQuery.removeEventListener('change', applyQuality);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', pauseInteraction);
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
      starfield.group.traverse((object) => {
        if (object instanceof THREE.Points) object.geometry.dispose();
      });
      conflictLayer.dispose();
      feedLayer.dispose();
      referenceLayers.dispose();
      cameraLayer.dispose();
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
      conflictLayerRef.current.setClusters(globeMarkerBudget(clusters.filter(isPointPrecise), quality.markerLimit, [budgetSelectedId, budgetHoveredId]));
    }
  }, [clusters, quality.markerLimit, budgetSelectedId, budgetHoveredId]);

  // Calques par thème : « Conflits » n'allume que les foyers, une catégorie que ses points.
  useEffect(() => {
    if (conflictLayerRef.current) conflictLayerRef.current.group.visible = theme === 'all' || theme === 'conflict';
    const layer = feedLayerRef.current;
    if (!layer) return;
    const apply = () => layer.setItems(globeMarkerBudget(feedItemsFor(theme, feeds, weatherAll), quality.markerLimit, [budgetSelectedFeedId, budgetHoveredFeedId]));
    apply();
    // Les halos « < 2 h » et l'éclat suivent l'âge réel : recalcul chaque minute.
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, [theme, feeds, weatherAll, quality.markerLimit, budgetSelectedFeedId, budgetHoveredFeedId]);

  // Calques de référence : visibilité (éteints par défaut) et données chargées à la demande.
  useEffect(() => {
    const ref = referenceLayersRef.current;
    if (!ref) return;
    for (const id of LAYER_ORDER) ref.setVisible(id, layersOn[id] && Boolean(layers[id]?.data?.features.length));
  }, [layersOn, layers]);

  useEffect(() => {
    const layer = cameraLayerRef.current;
    if (!layer) return;
    layer.group.visible = camerasOn;
    if (camerasOn) layer.setCameras(cameras, degrees, selectedCameraId);
  }, [camerasOn, cameras, degrees, selectedCameraId]);

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
        globeMarkerBudget(feeds.filter((item) => {
          const kind = vehicleOf(item);
          return kind !== null && ((forced && kind !== 'merchant') || mobilesOn[kind]);
        }), quality.markerLimit, [budgetSelectedFeedId, budgetHoveredFeedId]),
      );
    apply();
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, [theme, feeds, mobilesOn, quality.markerLimit, budgetSelectedFeedId, budgetHoveredFeedId]);

  useEffect(() => {
    mobileLayerRef.current?.setHighlight(selectedFeedId, hoveredFeedId);
  }, [selectedFeedId, hoveredFeedId, feeds, theme, mobilesOn, quality.markerLimit]);

  useEffect(() => {
    feedLayerRef.current?.setHighlight(selectedFeedId, hoveredFeedId);
  }, [selectedFeedId, hoveredFeedId, feeds, theme, quality.markerLimit]);

  // Synchronisation sélection et survol
  useEffect(() => {
    if (conflictLayerRef.current) {
      conflictLayerRef.current.setSelected(selected?.id || null, hoveredId);
    }
  }, [selected, hoveredId, quality.markerLimit]);

  // Recentrage sur requête externe sans coup de zoom violent (le zoom choisi est conservé).
  useEffect(() => {
    if (focusRequest) cameraRef.current?.focus(focusRequest.lat, focusRequest.lon);
  }, [focusRequest]);

  // Contrôles manuels de la barre d'outils du globe.
  const zoomBy = (factor: number) => {
    const orbit = cameraRef.current;
    if (!orbit) return;
    orbit.zoomBy(factor);
    setDegrees(orbit.clusterDegrees);
  };
  const handleZoomIn = () => zoomBy(0.78);
  const handleZoomOut = () => zoomBy(1.28);
  const handleResetView = () => {
    cameraRef.current?.reset();
    setDegrees(2.4);
  };
  const handleNorthUp = () => cameraRef.current?.northUp();

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
