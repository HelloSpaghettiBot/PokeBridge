from __future__ import annotations

import glob
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import hashlib


@dataclass(frozen=True)
class AgentDefinition:
    name: str
    port: int
    pong: str
    build_directory: str
    log_name: str




KNOWN_GOOD_PACKET_AGENT = "packet-agent-20260721115716851.jar"
KNOWN_GOOD_PACKET_AGENT_SHA256 = "cae6ba163ac044a6250c0dc3f36e6e23767f270df067bae6b5b723ac462b37dd"


def packet_agent_jar(project_root: Path) -> Path:
    """Return the exact recorder build proven working by the original Codex run.

    Do not choose by modification time. Replacement ZIPs and Windows extraction
    can make experimental JARs appear newer and cause AgentInitializationException
    or VerifyError inside the target JVM.
    """
    path = project_root / "analysis" / "packet-agent-build" / KNOWN_GOOD_PACKET_AGENT
    if not path.is_file():
        raise FileNotFoundError(
            f"Known-good packet agent is missing: {path}. "
            "Extract the packet-agent pin replacement over the project folder."
        )
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest.lower() != KNOWN_GOOD_PACKET_AGENT_SHA256:
        raise RuntimeError(
            f"Known-good packet agent failed integrity validation: {path} "
            f"(expected {KNOWN_GOOD_PACKET_AGENT_SHA256}, got {digest})"
        )
    return path

AGENTS = (
    AgentDefinition("control", 37666, "OK PONG", "control-agent-build", "control-agent.log"),
    AgentDefinition("dex", 37667, "OK PONG DEX", "dex-agent-build", "dex-location-agent.log"),
    AgentDefinition("battle", 37668, "OK PONG BATTLE", "battle-control-agent-build", "battle-control-agent.log"),
    AgentDefinition("hunt", 37671, "OK PONG HUNT", "hunt-control-agent-build", "hunt-control-agent.log"),
    AgentDefinition("species", 37670, "OK PONG SPECIES", "species-agent-build", "species-agent.log"),
)


def newest_file(directory: Path, pattern: str) -> Path:
    candidates = [Path(item) for item in glob.glob(str(directory / pattern))]
    if not candidates:
        raise FileNotFoundError(f"No {pattern} file found in {directory}")
    return max(candidates, key=lambda path: path.stat().st_mtime_ns)


def find_java() -> Path:
    candidates: list[Path] = []
    for variable in ("JDK_HOME", "JAVA_HOME"):
        value = os.environ.get(variable)
        if value:
            candidates.append(Path(value) / "bin" / "java.exe")
            candidates.append(Path(value) / "bin" / "java")

    candidates.extend([
        Path(r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\java.exe"),
        Path(r"C:\Program Files\Java\jdk-21\bin\java.exe"),
    ])
    candidates.extend(Path(item) for item in glob.glob(r"C:\Program Files\Eclipse Adoptium\jdk-*\bin\java.exe"))
    candidates.extend(Path(item) for item in glob.glob(r"C:\Program Files\Java\jdk-*\bin\java.exe"))

    located = shutil.which("java")
    if located:
        candidates.append(Path(located))

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("Java JDK 21 was not found. Install Eclipse Temurin/Adoptium JDK 21 or set JAVA_HOME.")


def attach_agent(project_root: Path, process_id: int, agent: AgentDefinition, java_path: Path | None = None) -> str:
    java = java_path or find_java()
    attach_jar = packet_agent_jar(project_root)
    agent_jar = newest_file(project_root / "analysis" / agent.build_directory, "*.jar")
    log_path = project_root / "captures" / agent.log_name
    log_path.parent.mkdir(parents=True, exist_ok=True)
    tag = datetime.now().strftime("%Y%m%d%H%M%S%f")[:-3]
    options = f"{log_path},{agent.port},{tag}"
    command = [
        str(java),
        "--add-modules",
        "jdk.attach",
        "-cp",
        str(attach_jar),
        "lab.agent.AttachPacketAgent",
        str(process_id),
        str(agent_jar),
        options,
    ]
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    completed = subprocess.run(
        command,
        cwd=project_root,
        capture_output=True,
        text=True,
        timeout=90,
        creationflags=creation_flags,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "unknown attach error").strip()
        raise RuntimeError(f"Could not attach {agent.name} agent: {detail}")
    return f"{agent.name} agent attached on 127.0.0.1:{agent.port}"


def attach_packet_recorder(project_root: Path, process_id: int, output_path: Path, java_path: Path | None = None) -> str:
    java = java_path or find_java()
    packet_jar = packet_agent_jar(project_root)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.touch(exist_ok=True)
    command = [
        str(java),
        "--add-modules",
        "jdk.attach",
        "-cp",
        str(packet_jar),
        "lab.agent.AttachPacketAgent",
        str(process_id),
        str(packet_jar),
        str(output_path),
    ]
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    completed = subprocess.run(
        command,
        cwd=project_root,
        capture_output=True,
        text=True,
        timeout=90,
        creationflags=creation_flags,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "unknown recorder attach error").strip()
        raise RuntimeError(f"Could not attach plaintext packet recorder: {detail}")
    return f"packet recorder attached -> {output_path}"
