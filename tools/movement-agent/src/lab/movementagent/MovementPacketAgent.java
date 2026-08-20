package lab.movementagent;

import java.lang.instrument.Instrumentation;

public final class MovementPacketAgent {
  private MovementPacketAgent() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    MovementPacketAgentV2Impl.agentmain(options, instrumentation);
  }
}
