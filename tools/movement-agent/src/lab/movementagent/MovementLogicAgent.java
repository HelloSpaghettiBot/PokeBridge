package lab.movementagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

/** Runs the official movement state transition, which queues the f.nm0 packet. */
public final class MovementLogicAgent {
  private MovementLogicAgent() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 5) throw new IllegalArgumentException("Expected LOG,DIRECTION,REPEAT,BETWEEN,TAG");
    Path log = Path.of(values[0]).toAbsolutePath();
    byte direction = Byte.parseByte(values[1]);
    int repeat = Integer.parseInt(values[2]);
    int betweenMs = Integer.parseInt(values[3]);
    String tag = values[4];
    Thread worker = new Thread(() -> run(log, direction, repeat, betweenMs, tag, instrumentation),
      "codex-movement-logic-agent");
    worker.setDaemon(true);
    worker.start();
  }

  private static void run(Path log, byte direction, int repeat, int betweenMs, String tag,
    Instrumentation instrumentation) {
    try {
      Class<?> globals = findLoaded(instrumentation, "f.Ot");
      Class<?> sessionType = findLoaded(instrumentation, "f.ln1");
      Field activeSession = globals.getField("Z02");
      Method move = sessionType.getMethod("bI", byte.class, boolean.class, boolean.class);
      for (int index = 0; index < repeat; index += 1) {
        Object session = activeSession.get(null);
        if (session == null) throw new IllegalStateException("No active game session");
        move.invoke(session, direction, false, false);
        write(log, "logic_sent tag=" + tag + " sequence=" + index + " direction=" + direction);
        if (index + 1 < repeat) Thread.sleep(betweenMs);
      }
    } catch (Throwable error) {
      write(log, "logic_error tag=" + tag + " " + root(error));
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
    } catch (IOException ignored) {}
  }
}
