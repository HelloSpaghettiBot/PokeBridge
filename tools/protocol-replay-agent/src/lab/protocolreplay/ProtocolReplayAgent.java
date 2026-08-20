package lab.protocolreplay;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/** Offline packet replay inside the already-running client class loader. */
public final class ProtocolReplayAgent {
  private ProtocolReplayAgent() {}

  public static void agentmain(String arguments, Instrumentation instrumentation) {
    Thread worker = new Thread(() -> replay(arguments), "protocol-replay-agent");
    worker.setDaemon(true);
    worker.start();
  }

  private static void replay(String arguments) {
    String[] parts = arguments.split(",", 2);
    Path output = Path.of(parts[0]);
    try {
      byte[] payload = hex(parts[1]);
      ClassLoader loader = ClassLoader.getSystemClassLoader();
      Object sides = decode(payload, loader);
      StringBuilder report = new StringBuilder();
      for (int sideIndex = 0; sideIndex < Array.getLength(sides); sideIndex++) {
        Object side = Array.get(sides, sideIndex);
        for (int slot = 0; slot < Array.getLength(side); slot++) {
          Object pokemon = Array.get(side, slot);
          if (pokemon == null) continue;
          Class<?> type = pokemon.getClass();
          short[] moves = (short[]) type.getMethod("Fj1").invoke(pokemon);
          byte[] pp = (byte[]) type.getMethod("HB1").invoke(pokemon);
          report.append("side=").append(sideIndex).append(" slot=").append(slot)
            .append(" species=").append(Short.toUnsignedInt(field(type, "w71").getShort(pokemon)))
            .append(" level=").append(Byte.toUnsignedInt(field(type, "zv0").getByte(pokemon)))
            .append(" shiny=").append(type.getMethod("Dk0").invoke(pokemon))
            .append(" secretShiny=").append(type.getMethod("dA1").invoke(pokemon))
            .append(" moves=");
          for (int index = 0; index < moves.length; index++) {
            if (index > 0) report.append('|');
            report.append(Short.toUnsignedInt(moves[index])).append(':').append(Byte.toUnsignedInt(pp[index]));
          }
          report.append(System.lineSeparator());
        }
      }
      PokemonView own = view(sides, 0, 0);
      PokemonView enemy = view(sides, 1, 0);
      for (int offset = 0; offset < payload.length; offset++) {
        for (int bit : new int[] {1, 4, 8}) {
          if ((payload[offset] & bit) != 0) continue;
          byte[] changed = payload.clone();
          changed[offset] |= (byte) bit;
          try {
            Object mutatedSides = decode(changed, loader);
            PokemonView mutatedOwn = view(mutatedSides, 0, 0);
            PokemonView mutatedEnemy = view(mutatedSides, 1, 0);
            if (mutatedOwn.shiny != own.shiny || mutatedOwn.secretShiny != own.secretShiny) {
              report.append("FLAG own offset=").append(offset).append(" bit=").append(bit)
                .append(" shiny=").append(mutatedOwn.shiny).append(" secret=").append(mutatedOwn.secretShiny)
                .append(System.lineSeparator());
            }
            if (mutatedEnemy.shiny != enemy.shiny || mutatedEnemy.secretShiny != enemy.secretShiny) {
              report.append("FLAG enemy offset=").append(offset).append(" bit=").append(bit)
                .append(" shiny=").append(mutatedEnemy.shiny).append(" secret=").append(mutatedEnemy.secretShiny)
                .append(System.lineSeparator());
            }
          } catch (Throwable ignored) {}
        }
        if (payload[offset] == 1) continue;
        byte[] changed = payload.clone();
        changed[offset] = 1;
        try {
          PokemonView mutatedOwn = view(decode(changed, loader), 0, 0);
          if (same(mutatedOwn.moves, own.moves) && !same(mutatedOwn.pp, own.pp)) {
            report.append("PP own offset=").append(offset).append(" values=").append(join(mutatedOwn.pp))
              .append(System.lineSeparator());
          }
        } catch (Throwable ignored) {}
      }
      write(output, report.toString());
    } catch (Throwable error) {
      while (error.getCause() != null) error = error.getCause();
      write(output, "ERROR " + error + System.lineSeparator());
    }
  }

  private static Object decode(byte[] payload, ClassLoader loader) throws Exception {
    Class<?> decoderClass = Class.forName("f.TB0", true, loader);
    Object decoder = decoderClass.getConstructor().newInstance();
    field(decoderClass, "tV").set(decoder, ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN));
    decoderClass.getMethod("qP1").invoke(decoder);
    return decoderClass.getField("Ak").get(decoder);
  }

  private static PokemonView view(Object sides, int sideIndex, int slot) throws Exception {
    Object pokemon = Array.get(Array.get(sides, sideIndex), slot);
    Class<?> type = pokemon.getClass();
    return new PokemonView(
      (Boolean) type.getMethod("Dk0").invoke(pokemon),
      (Boolean) type.getMethod("dA1").invoke(pokemon),
      (short[]) type.getMethod("Fj1").invoke(pokemon),
      (byte[]) type.getMethod("HB1").invoke(pokemon)
    );
  }

  private static boolean same(short[] left, short[] right) {
    if (left.length != right.length) return false;
    for (int index = 0; index < left.length; index++) if (left[index] != right[index]) return false;
    return true;
  }

  private static boolean same(byte[] left, byte[] right) {
    if (left.length != right.length) return false;
    for (int index = 0; index < left.length; index++) if (left[index] != right[index]) return false;
    return true;
  }

  private static String join(byte[] values) {
    StringBuilder output = new StringBuilder();
    for (int index = 0; index < values.length; index++) {
      if (index > 0) output.append('|');
      output.append(Byte.toUnsignedInt(values[index]));
    }
    return output.toString();
  }

  private record PokemonView(boolean shiny, boolean secretShiny, short[] moves, byte[] pp) {}

  private static Field field(Class<?> type, String name) throws ReflectiveOperationException {
    for (Class<?> current = type; current != null; current = current.getSuperclass()) {
      try {
        Field field = current.getDeclaredField(name);
        field.setAccessible(true);
        return field;
      } catch (NoSuchFieldException ignored) {}
    }
    throw new NoSuchFieldException(type.getName() + "." + name);
  }

  private static byte[] hex(String value) {
    byte[] bytes = new byte[value.length() / 2];
    for (int index = 0; index < bytes.length; index++) {
      bytes[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }

  private static void write(Path output, String value) {
    try {
      Files.writeString(output, value, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (Exception ignored) {}
  }
}
