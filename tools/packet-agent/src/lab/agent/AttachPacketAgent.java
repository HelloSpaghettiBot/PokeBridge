package lab.agent;

import com.sun.tools.attach.VirtualMachine;

public final class AttachPacketAgent {
  private AttachPacketAgent() {}

  public static void main(String[] args) throws Exception {
    if (args.length != 3) {
      throw new IllegalArgumentException("Usage: AttachPacketAgent PID AGENT_JAR OUTPUT_JSONL");
    }
    VirtualMachine target = VirtualMachine.attach(args[0]);
    try {
      target.loadAgent(args[1], args[2]);
    } finally {
      target.detach();
    }
  }
}
