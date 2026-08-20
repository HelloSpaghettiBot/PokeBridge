package lab.movementagent;

import java.lang.instrument.Instrumentation;

public final class MovementPacketAgentV2 {
  private MovementPacketAgentV2() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    MovementPacketAgentV2Impl.agentmain(options, instrumentation);
  }
}
