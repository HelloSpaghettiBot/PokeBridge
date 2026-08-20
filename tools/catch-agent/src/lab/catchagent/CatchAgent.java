package lab.catchagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.IdentityHashMap;

/** Throws an inventory-backed ball through the official battle UI action path. */
public final class CatchAgent {
  private CatchAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = options.split(",", -1);
    new Thread(() -> run(Path.of(values[0]), Short.parseShort(values[1]), values[2], instrumentation), "bridge-catch-agent").start();
  }
  private static void run(Path log, short itemId, String tag, Instrumentation instrumentation) {
    try {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      Object screen = globals.getField("B21").get(null);
      Object ui = find(screen, "f.h60", 0, new IdentityHashMap<>());
      if (ui == null) throw new IllegalStateException("Battle UI not found");
      Object inventoryPanel = ui.getClass().getField("eR0").get(ui);
      Object region = inventoryPanel.getClass().getField("NS1").get(inventoryPanel);
      Object session = globals.getField("Z02").get(null);
      Method inventoryForRegion = session.getClass().getMethod("kH", region.getClass());
      Object inventory = inventoryForRegion.invoke(session, region);
      Method byItemId = inventory.getClass().getMethod("aX0", short.class);
      Object stack = byItemId.invoke(inventory, itemId);
      if (stack == null) throw new IllegalStateException("No inventory stack for item " + itemId);
      Object item = stack.getClass().getField("Ub0").get(stack);
      Object token = item.getClass().getField("jD1").get(item);
      String name = String.valueOf(stack.getClass().getMethod("Mh1").invoke(stack));
      short quantity = (short) stack.getClass().getMethod("QF").invoke(stack);
      Method throwItem = ui.getClass().getMethod("JZ0", stack.getClass(), token.getClass(), byte.class);
      throwItem.invoke(ui, stack, token, (byte) -1);
      write(log, "CATCH_SENT tag=" + tag + " itemId=" + itemId + " name=" + name + " quantity=" + quantity);
    } catch (Throwable error) {
      while (error.getCause() != null) error = error.getCause();
      write(log, "CATCH_ERROR tag=" + tag + " " + error);
    }
  }
  private static Object find(Object value, String name, int depth, IdentityHashMap<Object, Boolean> seen) {
    if (value == null || depth > 6 || seen.put(value, Boolean.TRUE) != null) return null;
    if (value.getClass().getName().equals(name)) return value;
    if (value.getClass().isArray()) {
      for (int i = 0; i < Math.min(Array.getLength(value), 30); i++) { Object found = find(Array.get(value, i), name, depth + 1, seen); if (found != null) return found; }
      return null;
    }
    if (!value.getClass().getName().startsWith("f.")) return null;
    for (Class<?> cursor = value.getClass(); cursor != null && cursor != Object.class; cursor = cursor.getSuperclass()) {
      for (Field field : cursor.getDeclaredFields()) {
        if (Modifier.isStatic(field.getModifiers()) || !field.trySetAccessible()) continue;
        try { Object found = find(field.get(value), name, depth + 1, seen); if (found != null) return found; } catch (Throwable ignored) {}
      }
    }
    return null;
  }
  private static Class<?> loaded(Instrumentation instrumentation, String name) {
    for (Class<?> type : instrumentation.getAllLoadedClasses()) if (type.getName().equals(name)) return type;
    throw new IllegalStateException(name);
  }
  private static synchronized void write(Path path, String message) {
    try { Files.writeString(path, Instant.now() + " " + message + System.lineSeparator(), StandardOpenOption.CREATE, StandardOpenOption.APPEND); }
    catch (IOException ignored) {}
  }
}
