package lab.huntcontrol;

import java.io.*;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;

/** Battle policy primitives backed by the official client's live battle model. */
public final class HuntControlAgentV2 {
  private static volatile boolean started;
  private HuntControlAgentV2() {}

  public static synchronized void agentmain(String options, Instrumentation instrumentation) {
    if (started) return;
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 3) throw new IllegalArgumentException("Expected LOG_PATH,PORT,TAG");
    started = true;
    new Thread(() -> serve(Path.of(values[0]), Integer.parseInt(values[1]), values[2], instrumentation), "bridge-hunt-control").start();
  }

  private static void serve(Path log, int port, String tag, Instrumentation instrumentation) {
    try {
      Actions actions = new Actions(instrumentation);
      try (ServerSocket server = new ServerSocket(port, 8, InetAddress.getLoopbackAddress())) {
        write(log, "listening tag=" + tag + " port=" + port);
        while (!server.isClosed()) {
          try (Socket socket = server.accept();
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            PrintWriter writer = new PrintWriter(socket.getOutputStream(), true, StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) try {
            String command = line.trim();
            String upper = command.toUpperCase();
            String response;
            if (upper.startsWith("SWITCH ")) {
              response = actions.switchParty(Short.parseShort(command.substring(7).trim()));
            } else if (upper.startsWith("MOVEINFO ")) {
              response = actions.moveInfo(Short.parseShort(command.substring(9).trim()));
            } else if (upper.startsWith("KEY ")) {
              String[] parts = command.split("\\s+");
              if (parts.length < 2 || parts.length > 5) throw new IllegalArgumentException("KEY name [repeat] [durationMs] [betweenMs]");
              response = actions.key(parts[1], parts.length > 2 ? Integer.parseInt(parts[2]) : 1,
                parts.length > 3 ? Integer.parseInt(parts[3]) : 120,
                parts.length > 4 ? Integer.parseInt(parts[4]) : 120);
            } else response = switch (upper) {
              case "PING" -> "PONG HUNT";
              case "ENEMY" -> actions.enemy();
              case "OWN" -> actions.own();
              case "ACTIVE" -> actions.active();
              case "PARTY" -> actions.party();
              case "AUTO" -> actions.move(false);
              case "WEAKEN" -> actions.move(true);
              case "TRAINER" -> actions.trainerMove();
              case "RUN" -> actions.run();
              default -> throw new IllegalArgumentException("Unknown command: " + line);
            };
            writer.println("OK " + response);
            } catch (Throwable error) {
              while (error.getCause() != null) error = error.getCause();
              writer.println("ERR " + error);
              write(log, "command_error=" + line + " error=" + error);
            }
          } catch (SocketException error) {
            // A runner can be stopped while a request is in flight. That only
            // terminates this client; it must not take down the shared agent.
            if (!server.isClosed()) write(log, "client_disconnected=" + error);
          }
        }
      }
    } catch (Throwable error) { started = false; write(log, "server_error=" + error); }
  }

  private static final class Actions {
    final Field battleField;
    final Object session;
    final Field connection;
    final Method queue;
    final Constructor<?> movePacket;
    final Constructor<?> actionPacket;
    final Constructor<?> switchPacket;
    final Object fleeAction;
    final Object switchAction;
    final Object moveDatabase;
    final Method moveLookup;
    final Object input;
    final Method setKey;

    Actions(Instrumentation instrumentation) throws Exception {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      battleField = globals.getField("Bu");
      session = globals.getField("Z02").get(null);
      Class<?> sessionType = loaded(instrumentation, "f.ln1");
      connection = sessionType.getField("bf");
      Class<?> packetBase = loaded(instrumentation, "f.Uu1");
      queue = loaded(instrumentation, "f.hU").getMethod("wx1", packetBase);
      Class<?> actionType = loaded(instrumentation, "f.sV");
      Class<?> packetType = loaded(instrumentation, "f.z30");
      movePacket = findConstructor(packetType, parameters -> parameters.length == 3 && parameters[1] == short.class && parameters[2] == byte.class);
      Class<?> actorType = movePacket.getParameterTypes()[0];
      actionPacket = packetType.getConstructor(actorType, actionType);
      switchPacket = packetType.getConstructor(actorType, actionType, short.class);
      fleeAction = actionType.getField("uZ1").get(null);
      switchAction = actionType.getField("kb").get(null);
      Class<?> databaseType = loaded(instrumentation, "f.mj");
      moveDatabase = databaseType.getMethod("aF1").invoke(null);
      moveLookup = databaseType.getMethod("le0", short.class);
      Field inputField = findField(globals, "Da");
      input = inputField.get(null);
      setKey = input.getClass().getDeclaredMethod("R91", int.class, boolean.class);
      setKey.trySetAccessible();
    }

    Object battle() throws Exception { return battleField.get(null); }

    Object creature(int side) throws Exception {
      Object battle = battle();
      if (battle == null) return null;
      Object matrix = battle.getClass().getField("dO").get(battle);
      if (Array.getLength(matrix) <= side) return null;
      Object row = Array.get(matrix, side);
      for (int index = 0; index < Array.getLength(row); index++) {
        Object value = Array.get(row, index);
        if (value != null) return value;
      }
      return null;
    }

    String enemy() throws Exception {
      Object enemy = creature(1);
      if (enemy == null) return "NO_ENEMY";
      String species = String.valueOf(enemy.getClass().getMethod("M81").invoke(enemy)).replace(' ', '_');
      int speciesId = Short.toUnsignedInt(findField(enemy.getClass(), "w71").getShort(enemy));
      int level = Byte.toUnsignedInt(findField(enemy.getClass(), "zv0").getByte(enemy));
      int hp = Short.toUnsignedInt(((Number) enemy.getClass().getMethod("Kh").invoke(enemy)).shortValue());
      Object model = enemy.getClass().getField("ZU").get(enemy);
      int maxHp = Short.toUnsignedInt(findField(model.getClass(), "NV0").getShort(model));
      boolean shiny = (Boolean) enemy.getClass().getMethod("Dk0").invoke(enemy);
      boolean secretShiny = (Boolean) enemy.getClass().getMethod("dA1").invoke(enemy);
      Object owner = findField(enemy.getClass(), "d3").get(enemy);
      boolean wild = owner != null && owner.getClass().getName().equals("f.bU0");
      return "ENEMY species=" + species + " speciesId=" + speciesId + " level=" + level +
        " hp=" + hp + " maxHp=" + maxHp + " shiny=" + shiny + " secretShiny=" + secretShiny + " wild=" + wild;
    }

    String own() throws Exception {
      Object own = creature(0);
      if (own == null) return "NO_OWN_POKEMON";
      String species = String.valueOf(own.getClass().getMethod("M81").invoke(own)).replace(' ', '_');
      int level = Byte.toUnsignedInt(findField(own.getClass(), "zv0").getByte(own));
      int hp = Short.toUnsignedInt(((Number) own.getClass().getMethod("Kh").invoke(own)).shortValue());
      return "OWN species=" + species + " level=" + level + " hp=" + hp;
    }

    String party() throws Exception {
      Object currentBattle = battle();
      if (currentBattle == null) return "NO_PARTY_OUTSIDE_BATTLE";
      Object owners = findField(currentBattle.getClass(), "R20").get(currentBattle);
      if (owners == null || Array.getLength(owners) < 1) return "NO_PARTY_OWNER";
      Object owner = Array.get(owners, 0);
      if (owner == null) return "NO_PARTY_OWNER";
      Object members = findField(owner.getClass(), "l1").get(owner);
      if (members == null) return "NO_PARTY_MEMBERS";
      StringBuilder result = new StringBuilder("PARTY members=");
      boolean wrote = false;
      for (int slot = 0; slot < Math.min(6, Array.getLength(members)); slot++) {
        Object member = Array.get(members, slot);
        if (member == null) continue;
        Object model = findField(member.getClass(), "T20").get(member);
        if (model == null) continue;
        Object data = findField(model.getClass(), "pE").get(model);
        if (data == null) continue;
        int speciesId = Short.toUnsignedInt(findField(data.getClass(), "XB").getShort(data));
        int level = Byte.toUnsignedInt(findField(data.getClass(), "T8").getByte(data));
        if (speciesId < 1 || level < 1) continue;
        int hp = Short.toUnsignedInt(findField(data.getClass(), "rt1").getShort(data));
        int maxHp = Short.toUnsignedInt(findField(model.getClass(), "NV0").getShort(model));
        short[] moveIds = (short[]) findField(data.getClass(), "uW").get(data);
        byte[] movePp = (byte[]) findField(data.getClass(), "Aa0").get(data);
        if (wrote) result.append('|');
        wrote = true;
        result.append(slot).append(',').append(speciesId).append(',').append(level).append(',').append(hp).append(',').append(maxHp).append(',');
        boolean wroteMove = false;
        for (int move = 0; move < Math.min(moveIds.length, movePp.length); move++) {
          if (moveIds[move] <= 0) continue;
          if (wroteMove) result.append(';');
          wroteMove = true;
          result.append(Short.toUnsignedInt(moveIds[move])).append(':').append(Byte.toUnsignedInt(movePp[move]));
        }
      }
      return result.toString();
    }

    String active() throws Exception {
      Object pokemon = creature(0);
      if (pokemon == null) return "NO_ACTIVE_POKEMON";
      short[] ids = (short[]) pokemon.getClass().getMethod("Fj1").invoke(pokemon);
      byte[] pp = (byte[]) pokemon.getClass().getMethod("HB1").invoke(pokemon);
      StringBuilder result = new StringBuilder("ACTIVE moves=");
      for (int index = 0; index < Math.min(ids.length, pp.length); index++) {
        if (index > 0) result.append(';');
        result.append(Short.toUnsignedInt(ids[index])).append(':').append(Byte.toUnsignedInt(pp[index]));
      }
      return result.toString();
    }

    String move(boolean weakest) throws Exception {
      Object pokemon = creature(0);
      if (pokemon == null) return battle() == null ? "SKIPPED_OVERWORLD" : "NO_ACTIVE_POKEMON";
      if (((Number) pokemon.getClass().getMethod("Kh").invoke(pokemon)).intValue() <= 0) return "NO_ACTIVE_POKEMON";
      short[] ids = (short[]) pokemon.getClass().getMethod("Fj1").invoke(pokemon);
      byte[] pp = (byte[]) pokemon.getClass().getMethod("HB1").invoke(pokemon);
      int selected = -1, selectedPower = weakest ? Integer.MAX_VALUE : -1;
      String selectedName = "";
      for (int index = 0; index < Math.min(ids.length, pp.length); index++) {
        if (ids[index] <= 0 || pp[index] <= 0) continue;
        Object definition = moveLookup.invoke(moveDatabase, ids[index]);
        if (definition == null) continue;
        int power = Short.toUnsignedInt(shortField(definition, "XZ"));
        if (power <= 0 || (weakest ? power >= selectedPower : power <= selectedPower)) continue;
        selected = index; selectedPower = power;
        try { selectedName = String.valueOf(definition.getClass().getMethod("lw1").invoke(definition)); }
        catch (Throwable ignored) { selectedName = "Move_" + ids[index]; }
      }
      if (selected < 0) return "NO_DAMAGE_PP";
      queue.invoke(connection.get(session), movePacket.newInstance(null, ids[selected], (byte) 0));
      return (weakest ? "WEAKEN_MOVE" : "AUTO_MOVE") + " moveId=" + ids[selected] + " name=" +
        selectedName.replace(' ', '_') + " pp=" + Byte.toUnsignedInt(pp[selected]) + " power=" + selectedPower;
    }

    String trainerMove() throws Exception {
      String damaging = move(false);
      if (!damaging.equals("NO_DAMAGE_PP")) return damaging;
      Object pokemon = creature(0);
      if (pokemon == null) return "NO_ACTIVE_POKEMON";
      short[] ids = (short[]) pokemon.getClass().getMethod("Fj1").invoke(pokemon);
      byte[] pp = (byte[]) pokemon.getClass().getMethod("HB1").invoke(pokemon);
      for (int index = 0; index < Math.min(ids.length, pp.length); index++) {
        if (ids[index] > 0 && pp[index] > 0) {
          queue.invoke(connection.get(session), movePacket.newInstance(null, ids[index], (byte) 0));
          return "TRAINER_LEGAL_MOVE moveId=" + ids[index] + " pp=" + Byte.toUnsignedInt(pp[index]);
        }
      }
      queue.invoke(connection.get(session), movePacket.newInstance(null, (short) 165, (byte) 0));
      return "TRAINER_STRUGGLE moveId=165";
    }

    String moveInfo(short moveId) throws Exception {
      Object definition = moveLookup.invoke(moveDatabase, moveId);
      if (definition == null) return "NO_MOVE moveId=" + Short.toUnsignedInt(moveId);
      int power = Short.toUnsignedInt(shortField(definition, "XZ"));
      Object type = findField(definition.getClass(), "fy1").get(definition);
      String typeName = type == null ? "Unknown" : String.valueOf(type.getClass().getMethod("lG1").invoke(type)).replace(' ', '_');
      String name = String.valueOf(definition.getClass().getMethod("lw1").invoke(definition)).replace(' ', '_');
      return "MOVE moveId=" + Short.toUnsignedInt(moveId) + " name=" + name + " power=" + power + " type=" + typeName;
    }

    String run() throws Exception {
      if (battle() == null) return "SKIPPED_OVERWORLD";
      queue.invoke(connection.get(session), actionPacket.newInstance(null, fleeAction));
      return "FLEE_SENT";
    }

    String switchParty(short slot) throws Exception {
      if (slot < 0 || slot > 5) throw new IllegalArgumentException("Party slot must be 0..5");
      if (battle() == null) return "SKIPPED_OVERWORLD";
      queue.invoke(connection.get(session), switchPacket.newInstance(null, switchAction, slot));
      return "SWITCH_SENT slot=" + slot;
    }

    String key(String name, int repeat, int durationMs, int betweenMs) throws Exception {
      int key = switch (name.toUpperCase()) {
        case "UP" -> 19; case "DOWN" -> 20; case "LEFT" -> 21; case "RIGHT" -> 22;
        case "A" -> 54; case "B" -> 52; case "X" -> 47; case "Y" -> 29;
        default -> throw new IllegalArgumentException("Unknown key: " + name);
      };
      if (repeat < 1 || repeat > 20 || durationMs < 30 || durationMs > 2000 || betweenMs < 0 || betweenMs > 5000) {
        throw new IllegalArgumentException("Invalid key timing");
      }
      for (int index = 0; index < repeat; index++) {
        setKey.invoke(input, key, true);
        Thread.sleep(durationMs);
        setKey.invoke(input, key, false);
        if (index + 1 < repeat) Thread.sleep(betweenMs);
      }
      return "KEY_SENT name=" + name.toUpperCase() + " repeat=" + repeat;
    }
  }

  private static Field findField(Class<?> type, String name) throws Exception {
    for (Class<?> cursor = type; cursor != null; cursor = cursor.getSuperclass()) try {
      Field field = cursor.getDeclaredField(name); field.trySetAccessible(); return field;
    } catch (NoSuchFieldException ignored) {}
    throw new NoSuchFieldException(name);
  }
  private static short shortField(Object value, String name) throws Exception { return findField(value.getClass(), name).getShort(value); }
  private static Constructor<?> findConstructor(Class<?> type, java.util.function.Predicate<Class<?>[]> match) throws NoSuchMethodException {
    for (Constructor<?> constructor : type.getConstructors()) if (match.test(constructor.getParameterTypes())) return constructor;
    throw new NoSuchMethodException(type.getName() + " compatible constructor");
  }
  private static Class<?> loaded(Instrumentation instrumentation, String name) {
    ClassLoader loader = null;
    for (Class<?> type : instrumentation.getAllLoadedClasses()) {
      if (type.getName().equals(name)) return type;
      if (type.getName().equals("f.Ot")) loader = type.getClassLoader();
    }
    try { return Class.forName(name, false, loader); }
    catch (ClassNotFoundException error) { throw new IllegalStateException("Class unavailable: " + name, error); }
  }
  private static synchronized void write(Path path, String message) {
    try { Files.writeString(path, Instant.now() + " " + message + System.lineSeparator(), StandardOpenOption.CREATE, StandardOpenOption.APPEND); }
    catch (Exception ignored) {}
  }
}
