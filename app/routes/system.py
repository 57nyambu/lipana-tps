# SPDX-License-Identifier: Apache-2.0
"""
System routes — Kubernetes cluster management, pod logs, scaling,
and configuration management for the Tazama pipeline components.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_api_key
from app.config import settings

logger = logging.getLogger("lipana.system")
router = APIRouter(prefix="/api/v1/system", tags=["System — Cluster Management"])


# ── Kubernetes Client Helper ─────────────────────────────────

def _get_k8s_clients():
    """Get Kubernetes CoreV1Api and AppsV1Api clients."""
    try:
        from kubernetes import client, config as k8s_config

        if settings.k8s_in_cluster:
            try:
                k8s_config.load_incluster_config()
            except k8s_config.ConfigException:
                # Fallback to kubeconfig for local dev
                if settings.k8s_kubeconfig:
                    k8s_config.load_kube_config(config_file=settings.k8s_kubeconfig)
                else:
                    k8s_config.load_kube_config()
        else:
            if settings.k8s_kubeconfig:
                k8s_config.load_kube_config(config_file=settings.k8s_kubeconfig)
            else:
                k8s_config.load_kube_config()

        core_v1 = client.CoreV1Api()
        apps_v1 = client.AppsV1Api()
        return core_v1, apps_v1
    except Exception as exc:
        logger.error("Failed to initialize Kubernetes client: %s", exc)
        raise HTTPException(status_code=503, detail=f"Kubernetes unavailable: {exc}")


# ── Pod endpoints ────────────────────────────────────────────

@router.get(
    "/pods",
    summary="List all pods",
    description="List all pods in the Tazama Kubernetes namespace with status and resource details.",
)
async def list_pods(
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    core_v1, _ = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        pods = core_v1.list_namespaced_pod(namespace=ns)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Failed to list pods: {exc}")

    results = []
    for pod in pods.items:
        containers = []
        for c in pod.spec.containers:
            res = c.resources
            containers.append({
                "name": c.name,
                "image": c.image,
                "resources": {
                    "requests": {k: str(v) for k, v in (res.requests or {}).items()} if res and res.requests else {},
                    "limits": {k: str(v) for k, v in (res.limits or {}).items()} if res and res.limits else {},
                },
            })

        # Container statuses
        container_statuses = []
        for cs in (pod.status.container_statuses or []):
            state = "unknown"
            if cs.state.running:
                state = "running"
            elif cs.state.waiting:
                state = f"waiting: {cs.state.waiting.reason or 'unknown'}"
            elif cs.state.terminated:
                state = f"terminated: {cs.state.terminated.reason or 'unknown'}"

            container_statuses.append({
                "name": cs.name,
                "ready": cs.ready,
                "restart_count": cs.restart_count,
                "state": state,
                "image": cs.image,
            })

        ready_count = sum(1 for cs in (pod.status.container_statuses or []) if cs.ready)
        total_count = len(pod.spec.containers)

        results.append({
            "name": pod.metadata.name,
            "namespace": pod.metadata.namespace,
            "status": pod.status.phase,
            "ready": f"{ready_count}/{total_count}",
            "restarts": sum(cs.restart_count for cs in (pod.status.container_statuses or [])),
            "node": pod.spec.node_name,
            "ip": pod.status.pod_ip,
            "created": pod.metadata.creation_timestamp.isoformat() if pod.metadata.creation_timestamp else None,
            "labels": dict(pod.metadata.labels or {}),
            "containers": containers,
            "container_statuses": container_statuses,
        })

    return {
        "namespace": ns,
        "total": len(results),
        "pods": results,
    }


@router.get(
    "/pods/{pod_name}/logs",
    summary="Get pod logs",
    description="Retrieve logs from a specific pod. Optionally specify container name and tail lines.",
)
async def get_pod_logs(
    pod_name: str,
    container: str | None = Query(default=None, description="Container name (for multi-container pods)"),
    tail_lines: int = Query(default=200, ge=1, le=5000, description="Number of tail lines"),
    previous: bool = Query(default=False, description="Get logs from previous container instance"),
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    core_v1, _ = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        kwargs: dict[str, Any] = {
            "name": pod_name,
            "namespace": ns,
            "tail_lines": tail_lines,
            "previous": previous,
            "timestamps": True,
        }
        if container:
            kwargs["container"] = container

        logs = core_v1.read_namespaced_pod_log(**kwargs)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Failed to fetch logs: {exc}")

    return {
        "pod": pod_name,
        "container": container,
        "tail_lines": tail_lines,
        "log_lines": logs.split("\n") if logs else [],
        "total_lines": len(logs.split("\n")) if logs else 0,
    }


@router.post(
    "/pods/{pod_name}/restart",
    summary="Restart a pod",
    description="Delete a pod to trigger restart by its parent controller (Deployment/StatefulSet).",
)
async def restart_pod(
    pod_name: str,
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    core_v1, _ = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        core_v1.delete_namespaced_pod(name=pod_name, namespace=ns)
        logger.info("Pod %s deleted (restart) in namespace %s", pod_name, ns)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to restart pod: {exc}")

    return {
        "success": True,
        "message": f"Pod '{pod_name}' deleted — controller will recreate it",
        "pod": pod_name,
    }


# ── Deployment endpoints ─────────────────────────────────────

@router.get(
    "/deployments",
    summary="List deployments",
    description="List all deployments in the Tazama namespace with replica and image info.",
)
async def list_deployments(
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    _, apps_v1 = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        deploys = apps_v1.list_namespaced_deployment(namespace=ns)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Failed to list deployments: {exc}")

    results = []
    for d in deploys.items:
        results.append({
            "name": d.metadata.name,
            "replicas": d.spec.replicas,
            "ready_replicas": d.status.ready_replicas or 0,
            "available_replicas": d.status.available_replicas or 0,
            "updated_replicas": d.status.updated_replicas or 0,
            "images": [c.image for c in d.spec.template.spec.containers],
            "labels": dict(d.metadata.labels or {}),
            "created": d.metadata.creation_timestamp.isoformat() if d.metadata.creation_timestamp else None,
        })

    return {
        "namespace": ns,
        "total": len(results),
        "deployments": results,
    }


@router.post(
    "/deployments/{deploy_name}/scale",
    summary="Scale a deployment",
    description="Scale a deployment to the specified number of replicas.",
)
async def scale_deployment(
    deploy_name: str,
    replicas: int = Query(ge=0, le=10, description="Target replica count"),
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    _, apps_v1 = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        from kubernetes import client
        body = client.V1Scale(
            spec=client.V1ScaleSpec(replicas=replicas)
        )
        apps_v1.patch_namespaced_deployment_scale(
            name=deploy_name,
            namespace=ns,
            body=body,
        )
        logger.info("Deployment %s scaled to %d replicas", deploy_name, replicas)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to scale: {exc}")

    return {
        "success": True,
        "message": f"Deployment '{deploy_name}' scaled to {replicas} replicas",
        "deployment": deploy_name,
        "replicas": replicas,
    }


@router.post(
    "/deployments/{deploy_name}/restart",
    summary="Restart a deployment (rolling)",
    description="Trigger a rolling restart of a deployment by patching the pod template annotation.",
)
async def restart_deployment(
    deploy_name: str,
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    _, apps_v1 = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        body = {
            "spec": {
                "template": {
                    "metadata": {
                        "annotations": {
                            "lipana-tps/restartedAt": now,
                        }
                    }
                }
            }
        }
        apps_v1.patch_namespaced_deployment(
            name=deploy_name,
            namespace=ns,
            body=body,
        )
        logger.info("Deployment %s rolling restart triggered", deploy_name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to restart deployment: {exc}")

    return {
        "success": True,
        "message": f"Rolling restart triggered for '{deploy_name}'",
        "deployment": deploy_name,
    }


@router.patch(
    "/deployments/{deploy_name}/image",
    summary="Update deployment image",
    description="Update the container image of a deployment to trigger a rolling update.",
)
async def update_deployment_image(
    deploy_name: str,
    image: str = Query(description="New container image (e.g. myregistry/app:v2)"),
    container_name: str = Query(default=None, description="Container name to update (defaults to first)"),
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    _, apps_v1 = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        deploy = apps_v1.read_namespaced_deployment(name=deploy_name, namespace=ns)

        if container_name:
            updated = False
            for c in deploy.spec.template.spec.containers:
                if c.name == container_name:
                    c.image = image
                    updated = True
                    break
            if not updated:
                raise HTTPException(status_code=404, detail=f"Container '{container_name}' not found")
        else:
            deploy.spec.template.spec.containers[0].image = image

        apps_v1.replace_namespaced_deployment(name=deploy_name, namespace=ns, body=deploy)
        logger.info("Deployment %s image updated to %s", deploy_name, image)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update image: {exc}")

    return {
        "success": True,
        "message": f"Image updated to '{image}' for deployment '{deploy_name}'",
        "deployment": deploy_name,
        "image": image,
    }


# ── Services endpoint ────────────────────────────────────────

@router.get(
    "/services",
    summary="List services",
    description="List all Kubernetes services in the Tazama namespace.",
)
async def list_services(
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    core_v1, _ = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        services = core_v1.list_namespaced_service(namespace=ns)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Failed to list services: {exc}")

    results = []
    for svc in services.items:
        ports = []
        for p in (svc.spec.ports or []):
            ports.append({
                "name": p.name,
                "port": p.port,
                "target_port": str(p.target_port),
                "protocol": p.protocol,
                "node_port": p.node_port,
            })

        results.append({
            "name": svc.metadata.name,
            "type": svc.spec.type,
            "cluster_ip": svc.spec.cluster_ip,
            "ports": ports,
            "selector": dict(svc.spec.selector or {}),
            "created": svc.metadata.creation_timestamp.isoformat() if svc.metadata.creation_timestamp else None,
        })

    return {
        "namespace": ns,
        "total": len(results),
        "services": results,
    }


# ── Events endpoint ──────────────────────────────────────────

@router.get(
    "/events",
    summary="Recent cluster events",
    description="Get recent Kubernetes events in the Tazama namespace.",
)
async def list_events(
    limit: int = Query(default=50, ge=1, le=200),
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    core_v1, _ = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        events = core_v1.list_namespaced_event(namespace=ns)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Failed to list events: {exc}")

    # Sort by last timestamp (most recent first)
    sorted_events = sorted(
        events.items,
        key=lambda e: e.last_timestamp or e.metadata.creation_timestamp or "",
        reverse=True,
    )[:limit]

    results = []
    for ev in sorted_events:
        results.append({
            "type": ev.type,
            "reason": ev.reason,
            "message": ev.message,
            "involved_object": {
                "kind": ev.involved_object.kind,
                "name": ev.involved_object.name,
            },
            "count": ev.count,
            "first_time": ev.first_timestamp.isoformat() if ev.first_timestamp else None,
            "last_time": ev.last_timestamp.isoformat() if ev.last_timestamp else None,
            "source": ev.source.component if ev.source else None,
        })

    return {
        "namespace": ns,
        "total": len(results),
        "events": results,
    }


# ── Namespace resource summary ───────────────────────────────

@router.get(
    "/overview",
    summary="Cluster overview",
    description="High-level summary of the Tazama cluster: pod counts, deployment health, etc.",
)
async def cluster_overview(
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    core_v1, apps_v1 = _get_k8s_clients()
    ns = settings.k8s_namespace

    try:
        pods = core_v1.list_namespaced_pod(namespace=ns)
        deploys = apps_v1.list_namespaced_deployment(namespace=ns)
        services = core_v1.list_namespaced_service(namespace=ns)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Cluster query failed: {exc}")

    running = sum(1 for p in pods.items if p.status.phase == "Running")
    pending = sum(1 for p in pods.items if p.status.phase == "Pending")
    failed = sum(1 for p in pods.items if p.status.phase == "Failed")

    total_restarts = sum(
        sum(cs.restart_count for cs in (p.status.container_statuses or []))
        for p in pods.items
    )

    healthy_deploys = sum(
        1 for d in deploys.items
        if (d.status.ready_replicas or 0) == (d.spec.replicas or 0) and d.spec.replicas > 0
    )

    return {
        "namespace": ns,
        "pods": {
            "total": len(pods.items),
            "running": running,
            "pending": pending,
            "failed": failed,
            "total_restarts": total_restarts,
        },
        "deployments": {
            "total": len(deploys.items),
            "healthy": healthy_deploys,
            "unhealthy": len(deploys.items) - healthy_deploys,
        },
        "services": {
            "total": len(services.items),
        },
    }
