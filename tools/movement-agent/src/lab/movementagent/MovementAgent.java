package lab.movementagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

/** Sends the official f.nm0 absolute-position movement packet through the official connection. */
final class MovementPacketAgentV2Impl {
  private MovementPacketAgentV2Impl() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 5) {
      throw new IllegalArgumentException("Expected LOG_PATH,DIRECTION,REPEAT,BETWEEN_MS,PROCESS_TAG");
    }
    Path logPath = Path.of(values[0]).toAbsolutePath();
    byte direction = Byte.parseByte(values[1]);
    int repeat = Integer.parseInt(values[2]);
    int betweenMs = Integer.parseInt(values[3]);
    String tag = values[4];

    Thread worker = new Thread(
      () -> run(logPath, direction, repeat, betweenMs, tag, instrumentation),
      "codex-movement-packet-agent"
    );
    worker.setDaemon(true);
    worker.start();
  }

  private static void run(
    Path logPath,
    byte direction,
    int repeat,
    int betweenMs,
    String tag,
    Instrumentation instrumentation
  ) {
    try {
      Class<?> globalsClass = findLoaded(instrumentation, "f.Ot");
      Class<?> sessionClass = findLoaded(instrumentation, "f.ln1");
      Class<?> packetClass = findLoaded(instrumentation, "f.nm0");
      Class<?> directionPacketClass = findLoaded(instrumentation, "f.GT");
      Class<?> packetBaseClass = findLoaded(instrumentation, "f.Uu1");
      Class<?> connectionClass = findLoaded(instrumentation, "f.hU");
      Class<?> positionClass = findLoaded(instrumentation, "f.Wi1");

      Constructor<?> positionCopy = positionClass.getConstructor(positionClass);
      Constructor<?> packetConstructor = packetClass.getConstructor(positionClass, boolean.class, boolean.class);
      Constructor<?> directionPacketConstructor = directionPacketClass.getConstructor(byte.class);
      Field activeSession = globalsClass.getField("Z02");
      Field connection = sessionClass.getField("bf");
      Field world = sessionClass.getField("tE0");
      Field localPlayer = world.getType().getField("cy");
      Field livePosition = localPlayer.getType().getField("F61");
      Field xField = positionClass.getField("q90");
      Field yField = positionClass.getField("sj0");
      Field directionField = positionClass.getField("lc1");
      Method send = connectionClass.getMethod("wx1", packetBaseClass);

      for (int index = 0; index < repeat; index += 1) {
        Object session = activeSession.get(null);
        if (session == null) throw new IllegalStateException("No active game session");
        Object player = localPlayer.get(world.get(session));
        Object current = livePosition.get(player);
        Object next = positionCopy.newInstance(current);
        short x = xField.getShort(current);
        short y = yField.getShort(current);
        if (direction == 0) y += 1;
        else if (direction == 1) y -= 1;
        else if (direction == 2) x -= 1;
        else if (direction == 3) x += 1;
        else throw new IllegalArgumentException("Invalid direction: " + direction);
        xField.setShort(next, x);
        yField.setShort(next, y);
        directionField.setByte(next, direction);
        Object directionPacket = directionPacketConstructor.newInstance(direction);
        Object packet = packetConstructor.newInstance(next, false, false);
        send.invoke(connection.get(session), directionPacket);
        send.invoke(connection.get(session), packet);
        write(logPath, "sent tag=" + tag + " sequence=" + index + " x=" + x + " y=" + y
          + " direction=" + direction);
        if (index + 1 < repeat) Thread.sleep(betweenMs);
      }
      write(logPath, "queued tag=" + tag + " repeat=" + repeat + " direction=" + direction);
    } catch (Throwable error) {
      write(logPath, "agent_error tag=" + tag + " " + root(error));
    }
  }

  private static Class<?> findLoaded(Instrumentation instrumentation, String name) {
    for (Class<?> candidate : instrumentation.getAllLoadedClasses()) {
      if (candidate.getName().equals(name)) return candidate;
    }
    throw new IllegalStateException("Required class is not loaded: " + name);
  }

  private static Throwable root(Throwable error) {
    Throwable current = error;
    while (current.getCause() != null) current = current.getCause();
    return current;
  }

  private static synchronized void write(Path path, String message) {
    try {
      Path parent = path.getParent();
      if (parent != null) Files.createDirectories(parent);
      Files.writeString(path, Instant.now() + " " + message + System.lineSeparator(),
        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (IOException ignored) {
      // Diagnostics must never interfere with the client.
    }
  }
}
